import { Bot } from "grammy";
import type {
  ActionHandler,
  ActionRef,
  LayoutBuilderInterface,
  MenuRef,
  TelebotConfig,
  TelebotContext,
} from "./types.js";
import { createAction } from "./action/action.js";
import { createMenu } from "./menu/menu.js";
import { installMenu, sendMenu } from "./engine/engine.js";

/**
 * # Telebot
 *
 * The main entry-point for building Telegram bots declaratively.
 *
 * ### Quick Start
 * ```ts
 * import { Telebot } from "@superpackages/telebot";
 * import mainMenu from "./menus/main.js";
 *
 * const bot = Telebot.create({
 *   token: process.env.BOT_TOKEN!,
 *   menu: mainMenu,
 * });
 *
 * bot.start();
 * ```
 */

/**
 * Helper to build actions or menus attached to specific triggers.
 * Used internally by the {@link Telebot} class.
 */
class TriggerBuilder {
  private triggers: { commands?: string[]; words?: string[]; regexps?: RegExp[] } = {};

  /**
   * @internal
   */
  constructor(type: "command" | "word" | "regexp", value: string | RegExp) {
    if (type === "command") this.triggers.commands = [value as string];
    if (type === "word") this.triggers.words = [value as string];
    if (type === "regexp") this.triggers.regexps = [value as RegExp];
  }

  /**
   * Add a command trigger (e.g., /settings).
   * @param name - The command name without the leading slash.
   */
  command(name: string): TriggerBuilder {
    this.triggers.commands = [...(this.triggers.commands || []), name];
    return this;
  }

  /**
   * Add an exact word or phrase trigger.
   * @param text - The text to trigger on.
   */
  word(text: string): TriggerBuilder {
    this.triggers.words = [...(this.triggers.words || []), text];
    return this;
  }

  /**
   * Add a regular expression trigger.
   * @param pattern - The regex pattern to match against the message text.
   */
  regexp(pattern: RegExp): TriggerBuilder {
    this.triggers.regexps = [...(this.triggers.regexps || []), pattern];
    return this;
  }

  /**
   * Attach an action to the collected triggers.
   * @param handler - The function to handle the action.
   * @returns An {@link ActionRef} that can be used in menus.
   */
  action<P = undefined>(handler: ActionHandler<P>): ActionRef<P> {
    const ref = createAction(handler);
    ref.triggers = { ...this.triggers };
    return ref;
  }

  /**
   * Attach a menu to the collected triggers.
   * @param builder - A function to build the menu layout.
   * @param options - Optional menu settings.
   * @returns A {@link MenuRef} that can be used or sent.
   */
  menu(builder: (layout: LayoutBuilderInterface, ctx: TelebotContext) => void | Promise<void>, options?: { id?: string }): MenuRef {
    const ref = createMenu(builder, options);
    ref.triggers = { ...this.triggers };
    return ref;
  }
}

/**
 * The main entry-point for building Telegram bots declaratively.
 * 
 * Provides static methods to create triggers, actions, and menus.
 */
export class Telebot {
  /**
   * Create a trigger based on a command (e.g., `/start`).
   * @param name - The command name.
   */
  static command(name: string): TriggerBuilder {
    return new TriggerBuilder("command", name);
  }

  /**
   * Create a trigger based on an exact word or phrase.
   * @param text - The text to match.
   */
  static word(text: string): TriggerBuilder {
    return new TriggerBuilder("word", text);
  }

  /**
   * Create a trigger based on a regular expression.
   * @param pattern - The pattern to match.
   */
  static regexp(pattern: RegExp): TriggerBuilder {
    return new TriggerBuilder("regexp", pattern);
  }

  /**
   * Create a typed action with an optional payload generic.
   * @param handler - The logic to execute when the action is triggered.
   */
  static action<P = undefined>(handler: ActionHandler<P>): ActionRef<P> {
    return createAction(handler);
  }

  /**
   * Create a declarative menu.
   * @param builder - A layout builder function.
   * @param options - Optional configuration (e.g., fixed ID).
   */
  static menu(builder: (layout: LayoutBuilderInterface, ctx: TelebotContext) => void | Promise<void>, options?: { id?: string }): MenuRef {
    return createMenu(builder, options);
  }

  /**
   * Create a fully configured bot instance.
   * @param options - Configuration including token and root menu.
   */
  static create(options: TelebotConfig & { menu: MenuRef }): TelebotApp {
    return new TelebotApp(options);
  }
}

/**
 * A running bot instance with the menu tree installed.
 * 
 * Created via {@link Telebot.create}.
 */
export class TelebotApp {
  /** The underlying grammy bot instance. */
  readonly bot: Bot<TelebotContext>;
  private readonly config: TelebotConfig;
  private readonly rootMenu: MenuRef;

  private readonly installPromise: Promise<void>;

  /**
   * @internal Use {@link Telebot.create} instead.
   */
  constructor(options: TelebotConfig & { menu: MenuRef }) {
    this.config = options;
    this.rootMenu = options.menu;
    this.bot = new Bot<TelebotContext>(options.token);
    this.installPromise = installMenu(this.bot, this.rootMenu, this.config);
  }

  /**
   * Start the bot using long-polling.
   */
  async start(): Promise<void> {
    await this.installPromise;
    console.log("🤖 Telebot started");
    await this.bot.start();
  }

  /**
   * Manually send the root menu to a specific chat.
   * @param chatId - The recipient chat ID.
   * @param ctx - The current context.
   */
  async sendMenu(chatId: number, ctx: TelebotContext): Promise<void> {
    await sendMenu(this.bot, chatId, this.rootMenu, ctx, this.config.translator);
  }

  /**
   * Returns a callback function for webhook usage.
   * @see grammy documentation for parameters.
   */
  webhookCallback(path?: string, onTimeout?: "throw" | "return" | "continue", timeoutMilliseconds?: number) {
    return async (req: any, res: any, next?: any) => {
      await this.installPromise;
      // @ts-ignore
      return this.bot.webhookCallback(path, onTimeout, timeoutMilliseconds)(req, res, next);
    };
  }

  /**
   * Manually handle an update (e.g., from a custom webhook implementation).
   */
  async handleUpdate(update: any, webhookResponse?: any): Promise<void> {
    await this.installPromise;
    await this.bot.handleUpdate(update, webhookResponse);
  }
}
