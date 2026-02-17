# Actions and Triggers

Actions are the functional units of your bot. They can be attached to menu buttons or triggered globally by user messages.

## Types of Actions

Telebot distinguishes between two types of actions based on how they are defined:

### 1. Conversational Actions (Async)

Defined using an `async` function. These actions have access to the `conversation` helper, allowing them to wait for user input.

```ts
const myAction = Telebot.action(async ({ conversation }) => {
  const name = await conversation.ask("What is your name?");
  // ... process name
});
```

### 2. Sync Actions (Functional)

Defined using a standard function. These are executed immediately without entering a "conversation mode". Perfect for "Tab" switching or simple alerts.

```ts
layout.button("Option A").action(() => {
  selectedTab = "A"; // Updates internal state for the next render
});
```

## Global Triggers

You can make actions accessible via global input triggers. When triggered globally, these actions always start as a fresh conversation.

```ts
// Triggered by /start
const startAction = Telebot.command("start").action(...);

// Triggered by "Help" text
const helpAction = Telebot.word("Help").action(...);

// Triggered by regex with capture groups
const userAction = Telebot.regexp(/user_(\d+)/).action(async ({ payload }) => {
  // payload.id will contain the captured group
  console.log(payload.id);
});
```

## The Action Context

Every action handler receives a context object:

| Property       | Description                                                         |
| :------------- | :------------------------------------------------------------------ |
| `ctx`          | The standard Grammy `TelebotContext`.                               |
| `payload`      | Data passed from the button's `.payload()` or regex capture groups. |
| `conversation` | Helper for `ask()` and `form()` (Conversational actions only).      |
| `ui`           | Helpers for `toast()` and `alert()`.                                |

## Payloads

Payloads are JSON-serializable objects. When you use `.payload({ id: 1 })` on a button, Telebot encodes this data into the callback query.

> [!IMPORTANT]
> Since Telegram has a 64-character limit for callback data, keep your payload objects small. Use IDs instead of full objects.

## Inline Actions

For small logic, you can define actions directly inside the menu builder:

```ts
layout.button("Click me").action(async ({ ui }) => {
  await ui.toast("Hello!");
});
```
