/**
 * @jest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { useInView } from "react-intersection-observer";
import React from "react";

import useScheduler, { TASK_PRIORITIES } from "../src";

const setPriority = jest.fn();
const abort = jest.fn();
class TaskController {
  constructor({ priority }) {
    this.signal = priority;
    this.setPriority = (newPriority) => {
      this.signal = newPriority;
      setPriority(newPriority);
    };
    this.abort = (reason) => abort(this.signal, reason);
  }
}
jest.mock("react-intersection-observer", () => ({
  useInView: jest.fn(() => ({})),
}));

describe("useScheduler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useInView.mockImplementation(() => ({}));
    window.TaskController = TaskController;
    window.scheduler = { postTask: jest.fn(async (task) => task()) };
  });

  it("still execute tasks when window.scheduler is unavailable", async () => {
    window.scheduler = undefined;
    const { result, unmount } = renderHook(() => useScheduler());
    const { postTask } = result.current;
    const results = await postTask(() => "random task");

    expect(results).toEqual("random task");

    unmount();
  });

  it("does not run a failing task twice when window.scheduler is unavailable", async () => {
    window.scheduler = undefined;
    const { result } = renderHook(() => useScheduler());
    const task = jest.fn(() => {
      throw new Error("task error");
    });

    await expect(result.current.postTask(task)).rejects.toThrow("task error");
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("allow to queue tasks and abort the attached tasks on component unmount", async () => {
    const taskFn = (v) => v;
    const { result, unmount } = renderHook(() =>
      useScheduler({ defaultPriority: TASK_PRIORITIES.userVisible })
    );
    const { postTask } = result.current;
    const tasks = [
      {
        task: () =>
          taskFn(`task with ${TASK_PRIORITIES.userBlocking} priority`),
        options: { priority: TASK_PRIORITIES.userBlocking },
      },
      {
        task: () => taskFn(`task with ${TASK_PRIORITIES.userVisible} priority`),
        options: { priority: TASK_PRIORITIES.userVisible },
      },
      {
        task: () => taskFn(`task with ${TASK_PRIORITIES.background} priority`),
        options: { priority: TASK_PRIORITIES.background },
      },
      {
        task: () =>
          taskFn(
            `task with ${TASK_PRIORITIES.userBlocking} priority, detached`
          ),
        options: { priority: TASK_PRIORITIES.userBlocking, detached: true },
      },
      {
        task: () =>
          taskFn(`task with ${TASK_PRIORITIES.userVisible} priority, detached`),
        options: { priority: TASK_PRIORITIES.userVisible, detached: true },
      },
      {
        task: () =>
          taskFn(`task with ${TASK_PRIORITIES.background} priority, detached`),
        options: { priority: TASK_PRIORITIES.background, detached: true },
      },
      {
        task: () => taskFn(`task with default priority`),
      },
      {
        task: () => taskFn(`task with default priority and extra options`),
        options: { delay: 1000 },
      },
    ];

    const results = await Promise.all(
      tasks.map(({ task, options }) => postTask(task, options))
    );

    expect(results).toEqual([
      "task with user-blocking priority",
      "task with user-visible priority",
      "task with background priority",
      "task with user-blocking priority, detached",
      "task with user-visible priority, detached",
      "task with background priority, detached",
      "task with default priority",
      "task with default priority and extra options",
    ]);
    const expectedOptions = [
      { signal: "user-blocking" },
      { signal: "user-visible" },
      { signal: "background" },
      { priority: "user-blocking" },
      { priority: "user-visible" },
      { priority: "background" },
      { signal: "user-visible" },
      { signal: "user-visible", delay: 1000 },
    ];
    expectedOptions.forEach((options, i) =>
      expect(window.scheduler.postTask).toHaveBeenNthCalledWith(
        i + 1,
        tasks[i].task,
        options
      )
    );

    unmount();

    expect(abort).toHaveBeenCalledTimes(3);
    expect(abort.mock.calls[0][1]).toBeInstanceOf(DOMException);
    expect(abort.mock.calls[0][1].name).toEqual("AbortError");
    expect(setPriority).not.toHaveBeenCalled();
  });

  it("uses the default priority and warns when the priority is invalid", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useScheduler({ defaultPriority: TASK_PRIORITIES.background })
    );
    const task = () => "task";

    await result.current.postTask(task, { priority: "invalid" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(window.scheduler.postTask).toHaveBeenCalledWith(task, {
      signal: "background",
    });
    warn.mockRestore();
  });

  describe("with a task signal", () => {
    // Queue tasks instead of running them right away, so they can be aborted before running
    let queue;
    const flush = () => queue.splice(0).forEach((run) => run());
    beforeEach(() => {
      queue = [];
      window.scheduler.postTask = jest.fn(
        (task) =>
          new Promise((resolve, reject) => {
            queue.push(() => {
              try {
                resolve(task());
              } catch (e) {
                reject(e);
              }
            });
          })
      );
    });

    it("keeps attached tasks bound to the component", async () => {
      const { result } = renderHook(() => useScheduler());
      const controller = new AbortController();
      const promise = result.current.postTask(() => "task", {
        signal: controller.signal,
      });
      flush();

      await expect(promise).resolves.toEqual("task");
      expect(window.scheduler.postTask).toHaveBeenCalledWith(
        expect.any(Function),
        { signal: "user-blocking" }
      );
    });

    it("settles right away and never runs the task once aborted", async () => {
      const { result } = renderHook(() => useScheduler());
      const task = jest.fn();
      const controller = new AbortController();
      const promise = result.current.postTask(task, {
        signal: controller.signal,
      });
      controller.abort();

      await expect(promise).resolves.toBeUndefined();
      flush();
      expect(task).not.toHaveBeenCalled();
    });

    it("rejects with the abort reason when throwOnAbort is set", async () => {
      const { result } = renderHook(() => useScheduler());
      const controller = new AbortController();
      const promise = result.current.postTask(() => "task", {
        signal: controller.signal,
        throwOnAbort: true,
        detached: true,
      });
      controller.abort("cancelled");

      await expect(promise).rejects.toEqual("cancelled");
    });

    it("does not post tasks with an already aborted signal", async () => {
      const { result } = renderHook(() => useScheduler());

      await expect(
        result.current.postTask(() => "task", { signal: AbortSignal.abort() })
      ).resolves.toBeUndefined();
      expect(window.scheduler.postTask).not.toHaveBeenCalled();
    });
  });

  describe("yieldToMain", () => {
    it("uses scheduler.yield when available", async () => {
      window.scheduler.yield = jest.fn(async () => {});
      const { result } = renderHook(() => useScheduler());

      await expect(result.current.yieldToMain()).resolves.toBeUndefined();
      expect(window.scheduler.yield).toHaveBeenCalledTimes(1);
    });

    it("falls back to a timeout without scheduler.yield", async () => {
      window.scheduler = undefined;
      const { result } = renderHook(() => useScheduler());

      await expect(result.current[2]()).resolves.toBeUndefined();
    });

    it("throws once the component is unmounted, unless detached", async () => {
      const { result, unmount } = renderHook(() => useScheduler());
      const { yieldToMain } = result.current;
      unmount();

      await expect(yieldToMain()).rejects.toMatchObject({
        name: "AbortError",
      });
      await expect(yieldToMain({ detached: true })).resolves.toBeUndefined();
    });

    it("throws once its signal is aborted", async () => {
      const { result } = renderHook(() => useScheduler());

      await expect(
        result.current.yieldToMain({ signal: AbortSignal.abort("stop") })
      ).rejects.toEqual("stop");
    });

    it("stops a task that yields after unmount, according to throwOnAbort", async () => {
      window.scheduler = undefined;
      const { result, unmount } = renderHook(() => useScheduler());
      const { postTask, yieldToMain } = result.current;
      const afterYield = jest.fn();
      const task = async () => {
        await yieldToMain();
        afterYield();
      };

      const promise = postTask(task);
      const throwingPromise = postTask(task, { throwOnAbort: true });
      unmount();

      await expect(promise).resolves.toBeUndefined();
      await expect(throwingPromise).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(afterYield).not.toHaveBeenCalled();
    });
  });

  it("does not run attached tasks posted after the component is unmounted", async () => {
    const { result, unmount } = renderHook(() => useScheduler());
    const { postTask } = result.current;
    unmount();

    await expect(postTask(() => "task")).resolves.toBeUndefined();
    await expect(
      postTask(() => "task", { throwOnAbort: true })
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(postTask(() => "task", { detached: true })).resolves.toEqual(
      "task"
    );
    expect(window.scheduler.postTask).toHaveBeenCalledTimes(1);
  });

  it("only rejects aborted tasks when throwOnAbort is set", async () => {
    const abortError = new DOMException("Component unmounted", "AbortError");
    window.scheduler.postTask = jest.fn(async (task, { signal }) => {
      // eslint-disable-next-line no-param-reassign
      signal.aborted = true;
      throw abortError;
    });
    window.TaskController = function AbortableTaskController() {
      this.signal = { aborted: false };
      this.abort = abort;
    };
    const { result } = renderHook(() => useScheduler());

    await expect(
      result.current.postTask(() => "task")
    ).resolves.toBeUndefined();
    await expect(
      result.current.postTask(() => "task", { throwOnAbort: true })
    ).rejects.toBe(abortError);
  });

  it("still rejects tasks that fail for another reason", async () => {
    const error = new Error("task error");
    window.scheduler.postTask = jest.fn(async () => {
      throw error;
    });
    const { result } = renderHook(() => useScheduler());

    await expect(result.current.postTask(() => "task")).rejects.toBe(error);
  });

  it("still rejects tasks that fail for another reason after unmount", async () => {
    const error = new Error("task error");
    let fail;
    const { result, unmount } = renderHook(() => useScheduler());

    const promise = result.current.postTask(
      () =>
        new Promise((resolve, reject) => {
          fail = () => reject(error);
        })
    );
    unmount();
    fail();

    await expect(promise).rejects.toBe(error);
  });

  it("still rejects tasks that fail for another reason after unmount when window.scheduler is unavailable", async () => {
    window.scheduler = undefined;
    const error = new Error("task error");
    let fail;
    const { result, unmount } = renderHook(() => useScheduler());

    const promise = result.current.postTask(
      () =>
        new Promise((resolve, reject) => {
          fail = () => reject(error);
        })
    );
    unmount();
    fail();

    await expect(promise).rejects.toBe(error);
  });

  it("keeps working after a StrictMode remount", async () => {
    const { result } = renderHook(() => useScheduler(), {
      wrapper: React.StrictMode,
    });

    await expect(result.current.postTask(() => "task")).resolves.toEqual(
      "task"
    );
    expect(abort).not.toHaveBeenCalled();
  });

  it("returns a stable postTask function", () => {
    const { result, rerender } = renderHook(() => useScheduler());
    const { postTask } = result.current;
    rerender();

    expect(result.current.postTask).toBe(postTask);
  });

  it("change the current and incoming tasks priority when the component visibility change", async () => {
    const taskFn = (v) => v;

    // First render, we're not sure the component is in view, tasks priorities are kept
    useInView.mockImplementation(() => ({
      ref: {},
      inView: false,
      entry: null,
    }));
    const { result, rerender, unmount } = renderHook(() =>
      useScheduler({ defaultPriority: TASK_PRIORITIES.userVisible })
    );

    const tasks = [
      {
        task: () =>
          taskFn(`task with ${TASK_PRIORITIES.userBlocking} priority`),
        options: { priority: TASK_PRIORITIES.userBlocking },
      },
      {
        task: () => taskFn(`task with ${TASK_PRIORITIES.userVisible} priority`),
        options: { priority: TASK_PRIORITIES.userVisible },
      },
      {
        task: () => taskFn(`task with ${TASK_PRIORITIES.background} priority`),
        options: { priority: TASK_PRIORITIES.background },
      },
    ];

    await Promise.all(
      [tasks[0], tasks[2]].map(({ task, options }) =>
        result.current[0](task, options)
      )
    );

    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(
      1,
      tasks[0].task,
      { signal: "user-blocking" }
    );
    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(
      2,
      tasks[2].task,
      { signal: "background" }
    );

    // The component is not in view, tasks priorities are lowered
    useInView.mockImplementation(() => ({ ref: {}, inView: false, entry: {} }));
    rerender();

    expect(setPriority).toHaveBeenNthCalledWith(1, "background");
    expect(setPriority).toHaveBeenNthCalledWith(2, "background");

    await Promise.all(
      tasks.map(({ task, options }) => result.current[0](task, options))
    );

    [3, 4, 5].forEach((n, i) =>
      expect(window.scheduler.postTask).toHaveBeenNthCalledWith(
        n,
        tasks[i].task,
        { signal: "background" }
      )
    );

    // The component is in view, tasks priorities are restored
    useInView.mockImplementation(() => ({ ref: {}, inView: true, entry: {} }));
    rerender();

    expect(setPriority).toHaveBeenNthCalledWith(3, "user-blocking");
    expect(setPriority).toHaveBeenNthCalledWith(4, "background");
    expect(setPriority).toHaveBeenNthCalledWith(5, "user-visible");

    await Promise.all(
      tasks.map(({ task, options }) => result.current[0](task, options))
    );

    ["user-blocking", "user-visible", "background"].forEach((signal, i) =>
      expect(window.scheduler.postTask).toHaveBeenNthCalledWith(
        6 + i,
        tasks[i].task,
        { signal }
      )
    );

    unmount();

    expect(abort).toHaveBeenCalledTimes(3);
    expect(abort).toHaveBeenCalledWith("user-blocking", expect.anything());
    expect(abort).toHaveBeenCalledWith("background", expect.anything());
    expect(abort).toHaveBeenCalledWith("user-visible", expect.anything());
  });
});
