/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { useInView } from 'react-intersection-observer';
import React from 'react';

import useScheduler, { TASK_PRIORITIES } from '../src';

window.scheduler = { postTask: jest.fn(async (task) => task()) };
const setPriority = jest.fn();
const abort = jest.fn();
class TaskController {
  constructor({ priority }) {
    this.signal = priority;
    this.setPriority = (newPriority) => {
      this.signal = newPriority;
      setPriority(newPriority);
    };
    this.abort = () => abort(this.signal);
  }
}
window.TaskController = TaskController;
jest.mock('react-intersection-observer', () => ({
  useInView: jest.fn(() => ({})),
}));

describe('useScheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.scheduler = { postTask: jest.fn(async (task) => task()) };
  });

  it('still execute tasks when window.scheduler is unavailable', async () => {
    window.scheduler = undefined;
    const { result, unmount } = renderHook(() => useScheduler(TASK_PRIORITIES.userVisible));
    const { postTask } = result.current;
    const results = await postTask(() => 'random task');

    expect(results).toEqual('random task');

    unmount();
  });

  it('allow to queue tasks and abort the attached tasks on component unmount', async () => {
    const taskFn = (v) => v;
    const { result, unmount } = renderHook(() => useScheduler(TASK_PRIORITIES.userVisible));
    const { postTask } = result.current;
    const tasks = [
      {
        task: () => taskFn(`task with ${TASK_PRIORITIES.userBlocking} priority`),
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
        task: () => taskFn(`task with ${TASK_PRIORITIES.userBlocking} priority, detached`),
        options: { priority: TASK_PRIORITIES.userBlocking, detached: true },
      },
      {
        task: () => taskFn(`task with ${TASK_PRIORITIES.userVisible} priority, detached`),
        options: { priority: TASK_PRIORITIES.userVisible, detached: true },
      },
      {
        task: () => taskFn(`task with ${TASK_PRIORITIES.background} priority, detached`),
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

    const results = await Promise.all(tasks.map(({ task, options }) => postTask(task, options)));

    expect(results).toEqual([
      'task with user-blocking priority',
      'task with user-visible priority',
      'task with background priority',
      'task with user-blocking priority, detached',
      'task with user-visible priority, detached',
      'task with background priority, detached',
      'task with default priority',
      'task with default priority and extra options',
    ]);
    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(1, tasks[0].task, {
      priority: undefined,
      signal: 'user-blocking',
    });
    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(2, tasks[1].task, {
      priority: undefined,
      signal: 'user-visible',
    });
    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(3, tasks[2].task, {
      priority: undefined,
      signal: 'background',
    });
    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(4, tasks[3].task, {
      priority: 'user-blocking',
      signal: undefined,
    });
    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(5, tasks[4].task, {
      priority: 'user-visible',
      signal: undefined,
    });
    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(6, tasks[5].task, {
      priority: 'background',
      signal: undefined,
    });
    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(7, tasks[6].task, {
      priority: undefined,
      signal: 'user-visible',
    });
    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(8, tasks[7].task, {
      priority: undefined,
      signal: 'user-visible',
      delay: 1000,
    });

    unmount();

    expect(abort).toHaveBeenCalledTimes(3);
    expect(setPriority).not.toHaveBeenCalled();
  });

  it('change the current and incoming tasks priority when the component visibility change', async () => {
    const elem = document.createElement('div');
    const taskFn = (v) => v;

    //First render, we're not sure the coponent is in view, tasks priorities are keept
    useInView.mockImplementation(() => ({ ref: {}, inView: false, entry: null }));
    const { result, rerender, unmount  } = renderHook(() => useScheduler(TASK_PRIORITIES.userVisible));
    act(() => {
      result.current.ref = React.createRef(elem);
    });

    const tasks = [
      {
        task: () => taskFn(`task with ${TASK_PRIORITIES.userBlocking} priority`),
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

    await Promise.all([tasks[0], tasks[2]].map(({ task, options }) => result.current[0](task, options)));

    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(1, tasks[0].task, {
      priority: undefined,
      signal: 'user-blocking',
    });
    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(2, tasks[2].task, {
      priority: undefined,
      signal: 'background',
    });

    //The component is not in view, tasks priorities are lowered
    useInView.mockImplementation(() => ({ ref: {}, inView: false, entry: {} }));
    rerender();

    expect(setPriority).toHaveBeenNthCalledWith(1, 'background');
    expect(setPriority).toHaveBeenNthCalledWith(2, 'background');

    await Promise.all(tasks.map(({ task, options }) => result.current[0](task, options)));

    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(3, tasks[0].task, {
      priority: undefined,
      signal: 'background',
    });
    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(4, tasks[1].task, {
      priority: undefined,
      signal: 'background',
    });
    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(5, tasks[2].task, {
      priority: undefined,
      signal: 'background',
    });

    //The component is in view, tasks priorities are restored
    useInView.mockImplementation(() => ({ ref: {}, inView: true, entry: {} }));
    rerender();

    expect(setPriority).toHaveBeenNthCalledWith(3, 'user-blocking');
    expect(setPriority).toHaveBeenNthCalledWith(4, 'background');
    expect(setPriority).toHaveBeenNthCalledWith(5, 'user-visible');

    await Promise.all(tasks.map(({ task, options }) => result.current[0](task, options)));

    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(6, tasks[0].task, {
      priority: undefined,
      signal: 'user-blocking',
    });
    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(7, tasks[1].task, {
      priority: undefined,
      signal: 'user-visible',
    });
    expect(window.scheduler.postTask).toHaveBeenNthCalledWith(8, tasks[2].task, {
      priority: undefined,
      signal: 'background',
    });

    unmount();

    expect(abort).toHaveBeenCalledTimes(3);
    expect(abort).toHaveBeenCalledWith('user-blocking');
    expect(abort).toHaveBeenCalledWith('background');
    expect(abort).toHaveBeenCalledWith('user-visible');
  });
});
