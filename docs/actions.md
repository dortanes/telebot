# Actions and Triggers

Actions are the logic of your bot. They can be triggered by menu buttons or global triggers like commands, words, or regex.

## Creating an Action

```ts
import { Telebot } from "@superpackages/telebot";

const myAction = Telebot.action(async ({ ctx, payload, conversation, ui }) => {
  // Logic goes here
});
```

### Action Context

- `ctx`: The full Grammy `TelebotContext`.
- `payload`: Data passed from the button or trigger.
- `conversation`: The `ConversationHelper` for `ask()` and `form()`.
- `ui`: Helpers for `toast()` and `alert()`.

## Global Triggers

You can attach triggers to actions so they work even if the user isn't in a menu.

```ts
// Triggered by /help
const helpAction = Telebot.command("help").action(async ({ ctx }) => {
  await ctx.reply("Help content...");
});

// Triggered by specific words
Telebot.word("hello").action(async ({ ctx }) => {
  await ctx.reply("Hi there!");
});

// Triggered by Regex with Capture Groups
Telebot.regexp(/user_(\d+)/).action(async ({ payload }) => {
  // payload.id will be the captured digits
  console.log("Viewing user", payload.id);
});
```

## Attaching to Buttons

Actions are commonly attached to menu buttons:

```ts
layout.button("View Profile").payload({ userId: 123 }).action(profileAction);
```

## Static vs Inline Actions

You can define an action separately for reuse (as shown above) or inline for simple logic:

```ts
layout.button("Quick Hello").action(async ({ ctx }) => {
  await ctx.reply("Hello!");
});
```

> [!NOTE]
> Inline actions used inside `Telebot.menu()` are treated as conversational by default, meaning they can use `conversation.ask()`.
