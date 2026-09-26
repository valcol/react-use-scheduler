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

const createAbortError = () =>
  new DOMException("Component unmounted", "AbortError");

/**
 * A hook that allows you to schedule tasks and to automatically orchestrate them based on your component lifecycle and visibility.
 * @param {Object} [options]
 * @param {string} [options.defaultPriority="user-blocking"] - The default priority, can be overridden by setting a task priority.
 * @returns {{postTask: Function, ref: Function}}
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
        ...options
      } = {}
    ) => {
      const scheduler =
        typeof window === "undefined" ? undefined : window.scheduler;
      if (!scheduler) return task();

      if (!detached && isUnmounted.current) {
        if (throwOnAbort) throw createAbortError();
        return undefined;
      }

      try {
        const isPriorityValid = VALID_PRIORITIES.includes(priority);
        if (!isPriorityValid)
          // eslint-disable-next-line no-console
          console.warn(
            `Invalid priority: ${priority}. 'priority' must be one of [${VALID_PRIORITIES}]. ${defaultPriority} will be used.`
          );

        const taskPriority = isPriorityValid ? priority : defaultPriority;

        if (detached)
          return scheduler.postTask(task, {
            ...options,
            priority: taskPriority,
          });

        if (!controllers.current[taskPriority]) {
          controllers.current[taskPriority] = new window.TaskController({
            priority: isHiddenRef.current
              ? TASK_PRIORITIES.background
              : taskPriority,
          });
        }

        // The controller signal is set last so the task stays bound to the component lifecycle
        const { signal } = controllers.current[taskPriority];
        return scheduler.postTask(task, { ...options, signal }).catch((e) => {
          if (signal.aborted && !throwOnAbort) return undefined;
          throw e;
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
        return task();
      }
    },
    [defaultPriority]
  );

  const returnValue = [postTask, ref];
  returnValue.postTask = postTask;
  returnValue.ref = ref;

  return returnValue;
};

export default useScheduler;
