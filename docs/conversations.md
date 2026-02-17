# Conversations and Forms

Telebot makes it easy to collect information from users using linear conversations. Under the hood, it uses `@grammyjs/conversations` but provides a simplified `ask()` and `form()` API.

## Defining a Conversational Action

A conversational action is a reusable handler that can the bot's flow to wait for user input.

```ts
const feedbackAction = Telebot.action(async ({ conversation, ui }) => {
  const name = await conversation.ask("What is your name?");
  await ui.toast(`Thanks, ${name}!`);
});
```

## The `ask` Helper

The `ask()` method pauses execution and waits for a specific type of input:

### Text Input

```ts
const name = await conversation.ask("Enter your name:");
```

### Choice (Button) Selection

```ts
const choice = await conversation.ask("Choose a color:", (kb) => {
  kb.button("Red").id("r");
  kb.button("Blue").id("b");
});
```

### Numbers with Validation

```ts
const age = await conversation.ask("How old are you?", {
  type: "number",
  validate: (n) => n > 0 && n < 120,
  errorMessage: "Please enter a realistic age.",
});
```

## The `form` Helper

For collecting multiple fields at once, use `form()`:

```ts
const data = await conversation.form([
  { name: "username", question: "Pick a username:", type: "text" },
  { name: "age", question: "How old are you?", type: "number" },
]);

console.log(data.username, data.age);
```

## Single Message Flow

Telebot tries to keep the chat clean by editing the same prompt message during a conversation. When a conversation finishes or is cancelled, it can automatically return the user to the menu they came from.

## Cancellation

Every `ask()` prompt automatically includes a "🚫 Cancel" button. If the user clicks it, the conversation is terminated, and the user is navigated back to the origin menu.
