<div align="center">
  <h1>
    <br/>
    <br/>
    🪡
    <br />
    react-use-scheduler
    <br />
    <br />
    <br />
  </h1>
  <sup>
    <br />
    <br />
    <a href="https://www.npmjs.com/package/react-use-scheduler">
       <img src="https://img.shields.io/github/actions/workflow/status/valcol/react-use-scheduler/main.yml" alt="npm package" />
    </a>
    <a href="https://www.npmjs.com/package/react-use-scheduler">
       <img src="https://img.shields.io/bundlephobia/minzip/react-use-scheduler" alt="dep size" />
    </a>
    <a href="https://www.npmjs.com/package/react-use-scheduler">
      <img src="https://img.shields.io/npm/v/react-use-scheduler" alt="version" />
    </a>
    <br />
  </sup>
   <h3>A <a href="https://reactjs.org/docs/hooks-intro.html">React hook</a> that allows you to <a href="https://web.dev/optimize-long-tasks/#a-dedicated-scheduler-api">schedule tasks</a> and automatically orchestrate them based on your component lifecycle and visibility.<h3>
  <br />
  <br />
  <pre>npm i <a href="https://www.npmjs.com/package/react-use-scheduler">react-use-scheduler</a></pre>
  <pre>yarn add <a href="https://www.npmjs.com/package/react-use-scheduler">react-use-scheduler</a></pre>
  <br />
  <br />
</div>

`react-use-scheduler` helps you manage and prioritize tasks using the browser [Scheduler API](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler). This allows you to prioritize the tasks that are the most important for a good user experience, making your page more responsive, while still allowing less critical work to be done. It will automatically lower the current and incomming tasks priorities if the associated component exit the viewport, restore their priorities if the component re-enter the viewport, and abort current tasks if the component unmount.

# How to use

```js
// Use object destructing, so you don't need to remember the exact order
const { postTask, ref } = useScheduler(options);

// Or array destructing if you want to customize the field names
const [postTask, ref] = useScheduler(options);
```

<br />

> **⚠️** `react-use-scheduler` use the [Scheduler API](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler),
> make sure to install the [polyfill](https://github.com/GoogleChromeLabs/scheduler-polyfill) if needed.

<br />

The `useScheduler` hook returns a `postTask` function and a `ref` that you can pass to a component to bind the tasks scheduled with `postTask` to the component lifecycle and visibility. You can pass a default `priority` as an option if you want.

```js
import React, { useState } from "react";
import useScheduler, { TASK_PRIORITIES } from "react-use-scheduler";
//...

const Component = () => {
  const { postTask, ref } = useScheduler();
  const [hasBeenClicked, setHasBeenClicked] = useState(false);

  const onClick = () => {
    setHasBeenClicked(true);
    postTask(someLongTask, {
      priority: TASK_PRIORITIES.userVisible,
    });
    postTask(() => sendTracking("click"), {
      priority: TASK_PRIORITIES.background,
      detached: true,
    });
  };

  return (
    <button onClick={onClick} ref={ref}>
      hasBeenClicked ? 'Clicked!' : 'Click Me!'
    </button>
  );
};
```

# API

## Options

Provide these as the options argument to the `useInView` hook, ex:

```js
const { postTask, ref } = useScheduler({
  defaultPriority: TASK_PRIORITIES.userVisible,
});
```

| Name         | Type     | Default                        |     |
| ------------ | -------- | ------------------------------ | --- |
| **priority** | `string` | `TASK_PRIORITIES.userBlocking` |

One of:

- `TASK_PRIORITIES.background` for the lowest priority tasks.
- `TASK_PRIORITIES.userVisible` for medium priority tasks. This is the default if no priority is set.
- `TASK_PRIORITIES.userBlocking` for critical tasks that need to run at high priority.

## Return

### `postTask`

```js
postTask(fn, options);
```

**Options**

| Name         | Type      | Default                        | Description                                                                                                                                                    |
| ------------ | --------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **priority** | `string`  | `TASK_PRIORITIES.userBlocking` | Override the `priority` set in the options argument to the `useInView` hook.                                                                                   |
| **detached** | `boolean` | `false`                        | Set to `true` to **not** bind the task to the component lifecycle. The priority will never change and the task will not be cancelled if the component unmount. |

### `ref`

```js
<Component ref={ref} />
```

You can pass the `ref` to a component to bind the tasks scheduled with `postTask` to the component lifecycle and visibility.

- If the component exits the viewport, all the scheduled task priorities will be set to `background`.
- If the component re-enters the viewport, the scheduled task priorities will be restored to their initial values.
- If the component is unmounted, the scheduled tasks will be aborted.
