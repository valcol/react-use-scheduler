import { useEffect, useRef } from 'react';
import { useInView } from 'react-intersection-observer';

/**
 * See https://wicg.github.io/scheduling-apis/#sec-task-priorities
 */
 export const TASK_PRIORITIES = Object.freeze({ 
    userBlocking: 'user-blocking',
    userVisible: 'user-visible',
    background: 'background',
  });

/**
 * A hook that allow you to schedule tasks and to automatically bind them to your component lifecycle and visibility.
 * @param {string} [defaultPriority="user-blocking"] - The default priority, can be overridden by setting a task priority.
 * @returns {{postTask: postTask, ref: Function}}
 */
const useScheduler = (defaultPriority = TASK_PRIORITIES.userBlocking) => {
  const controllers = useRef({});
  const { ref, inView, entry } = useInView();

  useEffect(() => {
    if (entry) {
      Object.entries(controllers.current).forEach(([priority, controller]) =>
        controller.setPriority?.(inView ? priority : TASK_PRIORITIES.background),
      );
    }
  }, [inView, entry]);

  useEffect(() => () => Object.values(controllers.current).forEach((controller) => controller?.abort()), []);

  const postTask = async (task = Function.prototype, { detached = false, priority = defaultPriority, ...options } = {}) => {
    try {
      if (!window?.scheduler)
        return task();

      const isPriorityValid = Object.values(TASK_PRIORITIES).includes(priority);
      if (!isPriorityValid)
        console.warn(`Invalid priority: ${priority}. 'priority' must be one of [${Object.values(TASK_PRIORITIES)}]. ${defaultPriority} will be used.`);

      const taskPriority = isPriorityValid ? priority : defaultPriority;
      if (!controllers.current?.[taskPriority] && !detached) {
        const taskControllerPriority = !entry || (entry && inView) ? taskPriority : TASK_PRIORITIES.background;
        controllers.current[taskPriority] = new window.TaskController({ priority: taskControllerPriority });
      }

      return window.scheduler.postTask(task, {
        signal: !detached ? controllers.current[taskPriority].signal : undefined,
        priority: detached ? taskPriority : undefined,
        ...options,
      });  
    } catch(e) {
      console.error(e);
      return task();
    }
  };

  const returnValue = [postTask, ref];
  returnValue.postTask = postTask;
  returnValue.ref = ref;

  return returnValue;
};

export default useScheduler;
