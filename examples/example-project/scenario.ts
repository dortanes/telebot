import { Telebot } from "../../src/index.js";

/**
 * 1. Typed Action with Regexp Trigger
 * Demonstrates how to trigger an action using a regular expression.
 * The engine automatically extracts capture groups as payload.
 * Matches: "star 123", "STAR 42"
 */
const starAction = Telebot.regexp(/star (\d+)/i).action<{ id: number }>(async ({ ctx, payload }) => {
  await ctx.reply(`Selected star ID: ${payload.id}`);
});

/**
 * 1.1 Action for Admin Reset
 */
const resetAction = Telebot.action(async ({ ui }) => {
  await ui.alert("This would reset everything!");
});

/**
 * 2. Wizard-style Conversation with Word Trigger
 * Matches the exact phrase "buy star".
 */
const buyStarAction = Telebot.word("buy star").action(async ({ ctx, conversation }) => {
  // Input validation for a numeric type
  const amount = await conversation.ask("How many stars would you like to buy?", {
    type: "number",
    validate: (n) => n > 0 && n <= 100,
    errorMessage: "Please enter a number between 1 and 100."
  });

  // Keyboard-based selection (returns the button ID)
  const paymentMethod = await conversation.ask("Select payment method:", (keyboard) => {
    keyboard.button("💳 Credit Card").id("card");
    keyboard.button("₿ Cryptocurrency").id("crypto");
  });

  await ctx.reply(`Processing ${amount} stars via ${paymentMethod}...`);
});

/**
 * 3. Form-based Conversation with Command Trigger
 * Triggered via /register command.
 */
const registerAction = Telebot.command('register').action(async ({ ctx, conversation, ui }) => {
  // Quick feedback via Telegram toast (callback query answer)
  await ui.toast("Starting registration... ❤️");

  // The framework automatically guides the user through each field
  const form = await conversation.form<{ age: number; bio: string; photo: string }>([
    { name: "age", question: "How old are you?", type: "number" },
    { name: "bio", question: "Tell us a bit about yourself:", type: "text" },
    { name: "photo", question: "Please upload a profile picture:", type: "photo" }
  ]);

  // Using UI alerts for critical feedback
  if (form.age < 18) {
    return ui.alert("Sorry, you must be 18 or older to register.");
  }

  await ctx.reply(`Registration complete!\nAge: ${form.age}\nBio: ${form.bio}`);
});

/**
 * 4. Dynamic Lists with multiple triggers
 * Triggered via /stars command or "buy.stars" internal state.
 */
const starsMenu = Telebot.command('stars').regexp(/^buy\.stars$/).menu(layout => {
  layout.text("<i>Browse</i> available stars below:").parseAs("HTML");

  // Generate a dynamic list of items
  const stars = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, title: `Star ${i + 1}` }));

  layout.list(stars)
    .perPage(5)    // Items per page
    .columns(1)    // Visual grid columns
    .render((item) => {
      // Dynamic button generation for each item
      return layout.button(`⭐️ ${item.title}`)
        .payload({ id: item.id })
        .action(starAction);
    });

  // Conditional button using guards (e.g., admin-only)
  layout.button("💀 Critical Reset")
    .guard(ctx => ctx.user.isAdmin) // Only visible/accessible to admins
    .action(resetAction);

  // Nested menu demonstration
  layout.button("Options").menu(Telebot.menu(menu => {
    menu.button("Option A").action(() => {
      menu.text("<b>Option A</b> selected").parseAs("HTML");
    });
    
    menu.button("Option B").action(() => {
      menu.text("<b>Option B</b> selected").parseAs("HTML");
    });
  }, { id: "nested-menu" }));
});

/**
 * 5. Tabbed Navigation Pattern
 * Demonstrates how to create a menu that acts like tabs.
 */
const infoMenu = Telebot.command('info').menu(layout => {
  // .default() ensures this text/view is shown first
  layout.button("🏢 About Us").default().action(() => {
    layout.text("We are a leading developer of high-performance Telegram bots.");
  });

  layout.button("📞 Contact").action(() => {
    layout.text("<b>Email</b>: support@bot.example\n<b>Phone</b>: +1 555 0123").parseAs("HTML");
  });

  // External link
  layout.button("Visit Website").url("https://example.com");
});

/**
 * 6. Auto-refreshing Menus
 * Demonstrates dynamic content updates within a menu.
 */
const timeMenu = Telebot.menu(layout => {
  layout.text(`Current server time: ${new Date().toLocaleTimeString()}`);
  layout.refreshButton("Sync Time");
});

/**
 * Main Scenario Entry Point
 * Demonstrates grid layout configurations and dynamic labels.
 */
export default Telebot.menu(layout => {
  layout.maxPerRow(2); // Maximum of 2 buttons per row

  // Image
  layout.image("https://static.vecteezy.com/system/resources/thumbnails/050/393/628/small/cute-curious-gray-and-white-kitten-in-a-long-shot-photo.jpg")

  // Text
  layout.text("Welcome to the <b>Telebot</b> Example Scenario!\nSelect an option below to explore.")
    .parseAs("HTML");

  // Navigation to sub-menus
  layout.button("My Stars").id("stars").menu(starsMenu);

  layout.button("Registration")
    .id("register")
    .action(registerAction);

  // Layout control: row() forces the next button onto a new row
  layout.button("Buy Stars")
    .id("buy")
    .row()
    .guard(ctx => ctx.user.balance >= 0) // Logical guard
    .action(buyStarAction);

  // Dynamic button labels based on context
  layout.button(ctx => `Profile (${ctx.from?.first_name || "Guest"})`)
    .id("profile");

  layout.button("Information")
    .id("info")
    .menu(infoMenu);

  layout.button("Live Time")
    .id("time")
    .menu(timeMenu);
});
