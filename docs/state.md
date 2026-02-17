# Session Storage and State

Telebot manages state using Grammy's session plugin, but provides a streamlined way to track navigation history and user-specific data.

## Configuration

When creating a `Telebot` instance, you can configure how sessions are stored:

```ts
const bot = Telebot.create({
  token: process.env.BOT_TOKEN,
  menu: mainMenu,
  sessionStorage: myCustomStorage, // Optional: e.g. Redis, MongoDB, File
  resolveUser: async (ctx) => {
    // Optional: Load your database user and attach to ctx.user
    return await db.users.findUnique({ where: { telegramId: ctx.from.id } });
  },
});
```

## User Data (`ctx.user`)

If you provide a `resolveUser` function in the config, Telebot automatically resolves the user for every update and attaches it to `ctx.user`. This is available in all action handlers:

```ts
const profileAction = Telebot.action(async ({ ctx }) => {
  await ctx.reply(
    `Hello, ${ctx.user.name}! Your status is ${ctx.user.status}.`,
  );
});
```

## Persistent Session (`ctx.session`)

The standard `ctx.session` is available for storing arbitrary data that persists across updates for a specific user/chat.

```ts
const counterAction = Telebot.action(async ({ ctx }) => {
  ctx.session.count = (ctx.session.count || 0) + 1;
  await ctx.reply(`Count: ${ctx.session.count}`);
});
```

## Internal State

Telebot uses some internal session keys to manage its features:

- `__telebot_last_msg_id`: Tracks the main menu message to support "single message" editing.
- `originMenuId`: Tracks which menu the user was in before entering a conversation.
- `conversation`: Standard Grammy conversation state.

You should generally avoid modifying these keys manually.

## Using Custom Storage

Telebot is compatible with all Grammy storage adapters. Simply pass the adapter to the `sessionStorage` option.

```ts
import { FileAdapter } from "@grammyjs/storage-file";

const bot = Telebot.create({
  token: "...",
  menu: mainMenu,
  sessionStorage: new FileAdapter({ dirName: "sessions" }),
});
```
