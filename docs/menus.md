# Menus and Navigation

Telebot provides a declarative API for building nested menu structures with automatic "Back" navigation and pagination.

## Creating a Menu

Menus are created using `Telebot.menu()`. You provide a builder function that uses a fluent `LayoutBuilder` to define the message text and buttons.

```ts
import { Telebot } from "@superpackages/telebot";

const mainMenu = Telebot.menu((layout) => {
  layout.text("Welcome to the Bot! Choose an option:");

  layout.button("Settings").menu(settingsMenu);
  layout.button("Help").action(helpAction);
});
```

## Adding Buttons

The `layout.button(label)` method returns a `ButtonBuilder` with several configuration options:

### Navigation & Actions

- `.menu(menuRef)`: Opens another menu. Telebot automatically tracks the navigation stack and adds a "Back" button.
- `.action(handler)`: Triggers a logic handler.
  - If the handler is **async**, it becomes a **Conversational Action** (can use `conversation.ask()`).
  - If the handler is **sync**, it becomes a **Sync Action** (useful for immediate UI changes like tabs).
- `.url(link)`: Opens an external website.
- `.payload(data)`: Attaches a JSON-serializable object to the button, which is passed to the action's `payload` argument.

### Control & Logic

- `.id(string)`: Sets a stable identifier for the button. Recommended for buttons that change labels dynamically.
- `.guard(fn)`: A function `(ctx) => boolean`. If it returns `false`, the button is completely hidden from the user.
- `.default()`: Marks the button as the "fallback". If the user sends text that doesn't match any other button, this action is triggered.

## Layout & Rows

By default, Telebot places buttons in rows according to the `maxPerRow` setting.

```ts
Telebot.menu((layout) => {
  layout.maxPerRow(2); // Global limit for this menu

  layout.button("Line 1 - A");
  layout.button("Line 1 - B");

  layout.button("Line 2 - C").row(); // .row() forces a new line regardless of maxPerRow
  layout.button("Line 2 - D");
});
```

## Dynamic Lists (Pagination)

For long lists of items, use `layout.list()`:

```ts
layout
  .list(users)
  .perPage(5)
  .columns(2)
  .render((user) =>
    layout
      .button(user.name)
      .payload({ userId: user.id })
      .action(viewUserAction),
  );
```

Telebot automatically handles:

- Partitioning the items into pages.
- Adding "⬅️ 1/3 ➡️" controls.
- Keeping track of the current page per-chat in memory.

## Special Buttons

### Refresh

`layout.refreshButton("🔄 Update")` adds a button that simply re-runs the current menu builder and updates the message. Useful for live dashboards or status checks.

### Back Button

The "◀️ Back" button is added automatically to any menu opened via `.menu()`. You can customize its label globally in the `Telebot.create()` configuration via the `translator` hook.
