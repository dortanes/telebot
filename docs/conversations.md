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

```ts
const name = await conversation.ask("Enter your name:");
```

### Choice (Button) Selection

Passing a builder function to `ask()` displays an inline keyboard.

```ts
const choice = await conversation.ask("Choose a color:", (kb) => {
  kb.button("Red").id("r");
  kb.button("Blue").id("b");
});
// 'choice' will be the ID ("r" or "b") or the label if no ID is set.
```

### Specialized Input Types

You can request specific types of data using the `options` object:

```ts
// Numbers with validation
const age = await conversation.ask("How old are you?", {
  type: "number",
  validate: (n) => n > 0 && n < 120,
  errorMessage: "Please enter a realistic age (1-119).",
});

// Photo uploads
const fileId = await conversation.ask("Send me a photo:", {
  type: "photo",
  errorMessage: "That wasn't a photo. Try again!",
});
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
