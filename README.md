# 🤖 Telebot

**The declarative framework for building push-button Telegram bots with ease.**

Telebot is designed for developers who want to build complex, menu-driven Telegram bots without the boilerplate. It provides a fluent, declarative API for menus, automatic navigation, and streamlined conversations.

[![NPM Version](https://img.shields.io/npm/v/@superpackages/telebot.svg)](https://www.npmjs.com/package/@superpackages/telebot)
[![License](https://img.shields.io/npm/l/@superpackages/telebot.svg)](LICENSE)

## ✨ Features

- 🏗️ **Declarative Menus**: Define your bot's layout using a fluent builder API.
- 🔄 **Automatic Navigation**: Nested menus with built-in "Back" buttons.
- 💬 **Linear Conversations**: Collect user input easily with `ask()` and `form()`.
- 📝 **Single-Message Flow**: Edits the same message during interaction for a clean chat history.
- 🔡 **Type-Safe**: Written in TypeScript with full JSDoc documentation.
- 🌐 **Localization Support**: Built-in hooks for i18n.
- 🛠️ **Powered by Grammy**: Leverages the speed and reliability of the `grammy` framework.

## 🚀 Quick Start

### 1. Install

```bash
npm install @superpackages/telebot grammy
```

### 2. Create your bot

```typescript
import { Telebot } from "@superpackages/telebot";

// Define an action
const greetAction = Telebot.action(async ({ ctx, conversation }) => {
  const name = await conversation.ask("What is your name?");
  await ctx.reply(`Hello, ${name}! Welcome to the bot.`);
});

// Define a menu
const mainMenu = Telebot.menu((layout) => {
  layout.text("Main Menu");
  layout.button("Say Hello").action(greetAction);
  layout.button("External Link").url("https://github.com/dortanes/telebot");
});

// Start the bot
const bot = Telebot.create({
  token: "YOUR_BOT_TOKEN",
  menu: mainMenu,
});

bot.start();
```

## 📖 Documentation

Explore the detailed guides:

- [Menus and Navigation](docs/menus.md) - Building layouts, rows, and buttons.
- [Conversations and Forms](docs/conversations.md) - Collecting user input and complex data.
- [Actions and Triggers](docs/actions.md) - Logic, commands, and regex triggers.
- [State Management](docs/state.md) - Sessions, storage, and user resolution.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📜 License

[MIT](LICENSE)
