import { Telebot } from "../../src/index.js";
import mainMenu from "./scenario.js";

/**
 * Mock I18n class to demonstrate localization support.
 * In a real application, you might use a library like i18next.
 */
class I18n {
  t(key: string): string {
    const table: Record<string, string> = {
      "telebot.back": "🔙 Back",
      "telebot.cancel": "❌ Cancel",
      "telebot.conversation.use_buttons": "Please use the buttons provided.",
      "telebot.conversation.photo_error": "Please send a photo.",
      "telebot.conversation.text_error": "Please send text.",
      "telebot.conversation.number_error": "Please enter a valid number.",
      "telebot.conversation.invalid_error": "Invalid input.",
    };
    return table[key] || key;
  }
}

const i18n = new I18n();

/**
 * Configuration & Environment
 * Ensure the BOT_TOKEN is provided via environment variables.
 */
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("❌ Error: BOT_TOKEN environment variable is missing.");
  console.error("Usage: BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11 npm run start:example");
  process.exit(1);
}

console.log("🚀 Initializing Telebot example project...");

/**
 * Initialize the Telebot application.
 * This sets up the core engine, main menu scenario, and global handlers.
 */
const app = Telebot.create({
  token,
  menu: mainMenu,

  /**
   * Example user resolver: provides mock user data for context.
   * In production, this would typically involve a database lookup.
   */
  resolveUser: async (ctx) => ({
    isAdmin: true,   // Enabled for demo purposes to show admin-only buttons
    balance: 100,    // Set non-zero balance to enable purchase features
    username: ctx.from?.username,
  }),

  /**
   * Global translator hook.
   * The framework uses this to localize system messages and internal UI elements.
   */
  translator: (key, _ctx) => i18n.t(key),
});

/**
 * Global Error Handling
 * Captures and logs errors from the Telegraf instance.
 */
app.bot.catch((err) => {
  console.error("⚠️ Telebot error caught:", err);
});

/**
 * Start the application.
 */
app.start()
  .then(() => {
    console.log("✅ Bot is active and listening for updates!");
    console.log("👉 Interaction hint: Send /start to the bot in Telegram.");
  })
  .catch((err) => {
    console.error("❌ Failed to launch the bot:", err);
    process.exit(1);
  });
