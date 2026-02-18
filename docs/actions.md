# Actions and Triggers

Actions are the functional units of your bot. They can be attached to menu buttons or triggered globally by user messages.

## Types of Actions

Telebot distinguishes between two types of actions based on how they are defined:

### 1. Conversational Actions (Async)

Defined using an `async` function. These actions have access to the `conversation` helper, allowing them to wait for user input.

```ts
const myAction = Telebot.action(async ({ conversation, layout }) => {
  const name = await conversation.ask("What is your name?");
  layout.text(`Hello, ${name}!`);
  layout.button("Back").menu(mainMenu);
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

## Automatic Registration

By default, Telebot **automatically registers** all actions created using `Telebot.action()`, `Telebot.command()`, etc.

You don't need to manually link them to a menu for them to work. This ensures that any deep-linked action or global trigger is reachable from any state of the bot.
```

## The Action Context

Every action handler receives a context object:

| Property       | Description                                                         |
| :------------- | :------------------------------------------------------------------ |
| `ctx`          | The standard Grammy `TelebotContext`.                               |
| `payload`      | Data passed from the button's `.payload()` or regex capture groups. |
| `id`           | Shorthand for payload ID or button ID.                              |
| `conversation` | Helper for `ask()` and `form()` (Conversational actions only).      |
| `ui`           | Helpers for `toast()` and `alert()`.                                |
| `layout`       | Response builder for the action.                                    |
| `navigate`     | Shorthand to jump to a specific menu or the root menu.              |

## Payloads

Payloads are JSON-serializable objects. When you use `.payload({ id: 1 })` on a button, Telebot encodes this data into the callback query.

> [!WARNING]
> **Callback Data Size Limit (64 Bytes)**
> Telegram restricts callback data (the internal string sent by buttons) to exactly **64 bytes**.
>
> Telebot automatically optimizes this by:
>
> - Using extremely short prefixes (`a:`, `n:`, `p:`, etc.).
> - Using raw strings for single-ID payloads (e.g., `{id: "123"}` becomes just `123`).
>
> **However, you must still be careful:**
>
> - Avoid complex nested objects in payloads.
> - Use short, unique IDs for `menu(id)` or `action(id)`.
> - If your payload is a UUID or a long string, it might still overflow. If you see `BUTTON_DATA_INVALID`, your payload is too large.

## Inline Actions

For small logic, you can define actions directly inside the menu builder:

```ts
layout.button("Click me").action(async ({ ui, navigate }) => {
  await ui.toast("Hello!");
  // Inline actions can also trigger navigation
  await navigate(mainMenu);
});
```

> [!TIP]
> Use inline actions for quick UI updates or simple transitions that don't require external state management.

```

```
