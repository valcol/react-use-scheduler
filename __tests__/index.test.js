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
window.TaskController = TaskController;
jest.mock("react-intersection-observer", () => ({
  useInView: jest.fn(() => ({})),
}));

describe("useScheduler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useInView.mockImplementation(() => ({}));
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

  it("keeps attached tasks bound to the component even if a signal is passed", async () => {
    const { result } = renderHook(() => useScheduler());
    const task = () => "task";

    await result.current.postTask(task, { signal: "user signal" });

    expect(window.scheduler.postTask).toHaveBeenCalledWith(task, {
      signal: "user-blocking",
    });
  });

  it("rejects attached tasks posted after the component is unmounted", async () => {
    const { result, unmount } = renderHook(() => useScheduler());
    const { postTask } = result.current;
    unmount();

    await expect(postTask(() => "task")).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(postTask(() => "task", { detached: true })).resolves.toEqual(
      "task"
    );
    expect(window.scheduler.postTask).toHaveBeenCalledTimes(1);
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
