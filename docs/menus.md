# Menus and Navigation

Telebot provides a declarative API for building nested menu structures with automatic "Back" navigation and pagination.

## Creating a Menu

Menus are created using `Telebot.menu()`. You provide a builder function that uses a fluent `LayoutBuilder` to define the message text and buttons.

```ts
import { Telebot } from "@superpackages/telebot";

const mainMenu = Telebot.menu((layout) => {
  layout.text("Welcome to the Bot! Choose an option:");

  layout.button("Settings").navigation(settingsMenu);
  layout.button("Help").action(helpAction);
});
```

## Adding Buttons

The `layout.button(label)` method returns a `ButtonBuilder` with several configuration options:

- `.navigation(menu)`: Opens another menu.
- `.action(handler)`: Triggers a conversational action.
- `.payload(data)`: Attaches data to the action trigger.
- `.url(link)`: Opens an external website.
- `.guard(fn)`: Only shows the button if the function returns `true`.

## Layout Control

By default, buttons are placed in rows based on the `maxPerRow` setting (default is 1).

```ts
Telebot.menu((layout) => {
  layout.maxPerRow(2);
  layout.button("A");
  layout.button("B"); // On the same row as A
  layout.button("C").forceRow(); // Starts a new row
});
```

## Dynamic Lists (Pagination)

For long lists of items, use `layout.list()`:

```ts
layout
  .list(users)
  .perPage(5)
  .columns(1)
  .render((user) =>
    layout
      .button(user.name)
      .payload({ userId: user.id })
      .action(viewUserAction),
  );
```

Telebot automatically handles the "⬅️ 1/3 ➡️" pagination controls.

## Back Navigation

When navigating between menus via `.navigation()`, Telebot automatically adds a "◀️ Back" button to submenu layouts, allowing users to return to the parent menu.
