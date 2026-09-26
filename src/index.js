import { useCallback, useEffect, useRef } from "react";
import { useInView } from "react-intersection-observer";

/**
 * See https://wicg.github.io/scheduling-apis/#sec-task-priorities
 */
export const TASK_PRIORITIES = Object.freeze({
  userBlocking: "user-blocking",
  userVisible: "user-visible",
  background: "background",
});

const VALID_PRIORITIES = Object.values(TASK_PRIORITIES);

const createAbortError = (message = "Component unmounted") =>
  new DOMException(message, "AbortError");

const getAbortReason = (signal) =>
  signal.reason ?? createAbortError("Task aborted");

const getScheduler = () =>
  typeof window === "undefined" ? undefined : window.scheduler;

// Settle as soon as the signal aborts, without waiting for the task to be run
const raceAbort = (promise, signal) => {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(getAbortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
};

/**
 * A hook that allows you to schedule tasks and to automatically orchestrate them based on your component lifecycle and visibility.
 * @param {Object} [options]
 * @param {string} [options.defaultPriority="user-blocking"] - The default priority, can be overridden by setting a task priority.
 * @returns {{postTask: Function, yieldToMain: Function, ref: Function}}
 */
const useScheduler = ({
  defaultPriority = TASK_PRIORITIES.userBlocking,
} = {}) => {
  const controllers = useRef({});
  const isUnmounted = useRef(false);
  const { ref, inView, entry } = useInView();
  const isHidden = Boolean(entry) && !inView;
  const isHiddenRef = useRef(isHidden);

  useEffect(() => {
    isHiddenRef.current = isHidden;
    Object.entries(controllers.current).forEach(([priority, controller]) =>
      controller?.setPriority?.(
        isHidden ? TASK_PRIORITIES.background : priority
      )
    );
  }, [isHidden]);

  useEffect(() => {
    // Reset on (re)mount, so StrictMode's mount/unmount/mount cycle keeps working
    isUnmounted.current = false;
    return () => {
      isUnmounted.current = true;
      Object.values(controllers.current).forEach((controller) =>
        controller?.abort(createAbortError())
      );
      controllers.current = {};
    };
  }, []);

  const postTask = useCallback(
    async (
      task = Function.prototype,
      {
        detached = false,
        priority = defaultPriority,
        throwOnAbort = false,
        signal: taskSignal,
        ...options
      } = {}
    ) => {
      const isAborted = () =>
        Boolean(taskSignal?.aborted) || (!detached && isUnmounted.current);
      const settleAbort = (error) => {
        if (throwOnAbort) throw error;
        return undefined;
      };

      if (taskSignal?.aborted) return settleAbort(getAbortReason(taskSignal));
      if (!detached && isUnmounted.current)
        return settleAbort(createAbortError());

      const scheduler = getScheduler();
      if (!scheduler) {
        try {
          return await task();
        } catch (e) {
          if (isAborted()) return settleAbort(e);
          throw e;
        }
      }

      let signal;
      let promise;
      try {
        const isPriorityValid = VALID_PRIORITIES.includes(priority);
        if (!isPriorityValid)
          // eslint-disable-next-line no-console
          console.warn(
            `Invalid priority: ${priority}. 'priority' must be one of [${VALID_PRIORITIES}]. ${defaultPriority} will be used.`
          );

        const taskPriority = isPriorityValid ? priority : defaultPriority;
        // A task aborted through its own signal must not run, even if it is still queued
        const scheduledTask = taskSignal
          ? () => {
              if (taskSignal.aborted) throw getAbortReason(taskSignal);
              return task();
            }
          : task;

        if (detached) {
          promise = scheduler.postTask(scheduledTask, {
            ...options,
            priority: taskPriority,
          });
        } else {
          if (!controllers.current[taskPriority]) {
            controllers.current[taskPriority] = new window.TaskController({
              priority: isHiddenRef.current
                ? TASK_PRIORITIES.background
                : taskPriority,
            });
          }

          // The controller signal is set last so the task stays bound to the component lifecycle
          signal = controllers.current[taskPriority].signal;
          promise = scheduler.postTask(scheduledTask, { ...options, signal });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
        return task();
      }

      try {
        return await raceAbort(promise, taskSignal);
      } catch (e) {
        if (signal?.aborted || isAborted()) return settleAbort(e);
        throw e;
      }
    },
    [defaultPriority]
  );

  const yieldToMain = useCallback(
    async ({ detached = false, signal: taskSignal } = {}) => {
      const scheduler = getScheduler();
      // scheduler.yield() inherits the priority and signal of the task it is called from
      if (scheduler?.yield) await scheduler.yield();
      else
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });

      if (taskSignal?.aborted) throw getAbortReason(taskSignal);
      if (!detached && isUnmounted.current) throw createAbortError();
    },
    []
  );

  const returnValue = [postTask, ref, yieldToMain];
  returnValue.postTask = postTask;
  returnValue.ref = ref;
  returnValue.yieldToMain = yieldToMain;

  return returnValue;
};

export default useScheduler;
