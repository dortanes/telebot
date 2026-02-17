# Advanced Patterns

This guide covers advanced configuration and architectural patterns for complex Telebot applications.

## Custom Session Storage

By default, Telebot uses an in-memory session. For production, you should use a persistent store (Redis, MongoDB, PostgreSQL) via Grammy's storage adapters.

```ts
import { FileAdapter } from "@grammyjs/storage-file";

const bot = Telebot.create({
  token: "...",
  menu: rootMenu,
  sessionStorage: new FileAdapter({ dirName: "./sessions" }),
});
```

## User Resolution (`resolveUser`)

If your bot relies on a database, you can use `resolveUser` to automatically fetch user data and attach it to `ctx.user` for every update.

```ts
const bot = Telebot.create({
  token: "...",
  menu: rootMenu,
  resolveUser: async (ctx) => {
    // This is called before every action/menu render
    const user = await db.users.findUnique({ where: { telegramId: ctx.from.id } });
    return user || { isAdmin: false }; // Must return an object
  }
});

// Now accessible in any action:
const adminAction = Telebot.action(async ({ ctx }) => {
  if (ctx.user.isAdmin) { ... }
});
```

## Localization and Translation

Telebot provides a `translator` hook to localize internal strings (like "Back" and "Cancel" buttons) or your own menu text.

```ts
const bot = Telebot.create({
  token: "...",
  menu: rootMenu,
  translator: (key, ctx) => {
    const lang = ctx.from?.language_code || "en";
    return myI18n.t(lang, key);
  },
});
```

### Predefined Keys

Telebot looks for these keys during rendering:

- `telebot.back`: The "Back" button label.
- `telebot.cancel`: The "Cancel" button label.
- `telebot.conversation.use_buttons`: Warning when a user types instead of clicking a button during a choice prompt.
- `telebot.conversation.photo_error`: Error message for invalid photo input.

## TelebotApp Instance

The `Telebot.create()` method returns a `TelebotApp` instance. This instance gives you direct access to the underlying Grammy `Bot` for advanced middleware or custom handlers.

```ts
const app = Telebot.create({ ... });

// Access the raw Grammy bot
app.bot.on("message:voice", (ctx) => {
  ctx.reply("I don't support voice messages yet!");
});

app.start();
```

## Manual Menu Rendering

Sometimes you need to send a menu "out of band" (e.g., in response to a background job or a custom event).

```ts
import { sendMenu } from "@superpackages/telebot";

const app = Telebot.create({ ... });

// Manually send a menu to a specific user
await sendMenu(app.bot, userChatId, someMenuRef, ctx);
```
