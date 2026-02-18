# Conversations and Forms

Telebot makes it easy to collect information from users using linear conversations. Under the hood, it uses `@grammyjs/conversations` but provides a simplified `ask()` and `form()` API designed specifically for the "Single Message Flow".

## Defining a Conversational Action

A conversational action is any `async` action handler. When an async action is triggered, Telebot enters a conversation state for that chat.

```ts
const feedbackAction = Telebot.action(async ({ conversation, ui }) => {
  const name = await conversation.ask("What is your name?");
  await ui.toast(`Thanks, ${name}!`);
});
```

## The `ask` Helper

The `ask()` method pauses execution and waits for the user's next message or button click.

### Text Input (Default)

The `ask()` method now defaults to text input if no options are providing, and correctly infers the return type as `string`.

```ts
const name = await conversation.ask("Enter your name:"); // type: string
```

### Choice (Button) Selection

Passing a builder function to `ask()` displays a simple inline keyboard for choices. When a button is clicked, `ask()` returns the button's ID (or label text).

```ts
const choice = await conversation.ask("Choose a color:", (kb) => {
  kb.button("Red").id("r");
  kb.button("Blue").id("b");
  kb.button("Green"); // Returns "Green"
});
```

> [!NOTE]
> Buttons in `ask()` are for input selection only. If you need navigation, external URLs, or complex action handlers, use `conversation.say()` or regular menus.

#### Supported Button Methods in `ask()`:

- `.id(value)` - Set return value for `ask()`.
- `.row()` - Force a new layout row.

### Specialized Input Types

You can request specific types of data using the `options` object:

```ts
// Numbers with validation
const age = await conversation.ask("How old are you?", {
  type: "number",
  validate: async (n) => n > 0 && n < 120, // Now supports async!
  errorMessage: "Please enter a realistic age (1-119).",
});

// Photo uploads
const fileId = await conversation.ask("Send me a photo:", {
  type: "photo",
  errorMessage: "That wasn't a photo. Try again!",
});
```

## Non-blocking Prompts (`say`)

Use `conversation.say()` to update the prompt text and buttons without pausing execution. Unlike `ask()`, buttons in `say()` support the full Telebot button API (actions, navigation, URLs).

```ts
await conversation.say("Done! Choice recorded.", (kb) => {
  kb.button("Open Settings").navigate(settingsMenu); // Navigation
  kb.button("View Result").action(resultAction); // External Action
  kb.button("Custom Logic").action(async () => {
    // Inline logic
    await ui.toast("Executing helper...");
  });
  kb.button("Docs").url("https://..."); // External URL
});
```

#### Supported Button Methods in `say()`:

- `.action(ref | handler)` - Trigger an action or an inline arrow function.
- `.menu(ref)` / `.navigate(ref)` - Navigate to another menu.
- `.url(link)` - Open an external URL.
- `.payload(data)` - Pass custom data to actions.
- `.row()` - Force a new layout row.
- `.id(value)` - Set a custom callback ID.

## Manual Cleanup

If you need to remove the conversation prompt without navigating, use:

```ts
await conversation.delete();
```

## The `form` Helper

For collecting multiple fields in sequence, use `form()`. It returns a typed object once all questions are answered.

```ts
const data = await conversation.form([
  { name: "username", question: "Pick a username:", type: "text" },
  { name: "age", question: "How old are you?", type: "number" },
]);

console.log(data.username, data.age);
```

## Single Message Flow

To keep the chat clean, Telebot uses a "Single Message" approach:

1. When a conversation starts, it sends a prompt message.
2. For every subsequent `ask()`, it **edits** that same message.
3. If the user sends a text message, the bot **deletes** the user's message immediately to keep the history tidy (if permissions allow).
4. When the conversation ends or is cancelled, the prompt message is deleted or replaced by the origin menu.

## Cancellation

Every `ask()` prompt automatically includes a **"🚫 Cancel"** button.

- If the user clicks it, an internal error is thrown that terminates the action.
- Telebot catches this and automatically returns the user to the previous menu.
- You don't need to write any `try/catch` logic for cancellation unless you need manual cleanup.
