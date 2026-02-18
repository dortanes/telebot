import type { Context, CallbackQueryContext, StorageAdapter } from "grammy";

export type { StorageAdapter };
import type { Conversation, ConversationFlavor } from "@grammyjs/conversations";

// ─── User-extensible context ───────────────────────────────────────────────────

/**
 * Extend this interface via declaration merging to type `ctx.user`:
 *
 * ```ts
 * declare module "telebot" {
 *   interface TelebotUser { isAdmin: boolean; balance: number; }
 * }
 * ```
 */
export interface TelebotUser {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

import type { SessionFlavor } from "grammy";

/**
 * Internal session structure used by Telebot.
 */
export interface TelebotSession {
  /** Data for @grammyjs/conversations */
  conversation: object;
  /** Tracks the origin menu to handle "back" navigation and updates */
  originMenuId?: string;
}

/**
 * The context object used throughout the framework.
 * Extends Grammy's Context with a typed `user` property.
 * Includes SessionFlavor for conversation support.
 */
export type TelebotContext = ConversationFlavor<Context & SessionFlavor<TelebotSession> & {
  /** The current user, resolved via `resolveUser` config or defaults */
  user: TelebotUser;
}>;

/**
 * Context for callback query updates (button clicks).
 */
export type TelebotCallbackContext = CallbackQueryContext<TelebotContext>;

/**
 * Type for conversation handlers.
 */
export type TelebotConversation = Conversation<TelebotContext, TelebotContext>;

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Message parse modes supported by Telegram */
export type ParseMode = "HTML" | "Markdown" | "MarkdownV2";

// ─── Conversation ──────────────────────────────────────────────────────────────

/** Types of input that can be requested from the user */
export type AskFieldType = "text" | "number" | "photo";

/** Options for the `ask` helper in conversations */
export interface AskOptions<T = string> {
  /** Expected input type */
  type?: AskFieldType;
  /** Custom validation function (can be async) */
  validate?: (value: T) => boolean | Promise<boolean>;
  /** Message to send if validation fails */
  errorMessage?: string;
}

/** Configuration for a button in an `ask` keyboard */
export interface AskKeyboardButton {
  /** Button label */
  text: string;
  /** Optional button ID */
  _id?: string;
  /** Set the button ID */
  id(value: string): AskKeyboardButton;
  /** Set a URL (makes it a URL button) */
  url(value: string): AskKeyboardButton;
  /** Set an action handler */
  action(handler: ButtonActionHandler): AskKeyboardButton;
  /** Set a submenu to open */
  menu(ref: MenuRef): AskKeyboardButton;
  /** Navigate to a submenu (shorthand for .menu()) */
  navigate(ref: MenuRef): AskKeyboardButton;
  /** Set custom payload for the action */
  payload(data: Record<string, unknown>): AskKeyboardButton;
  /** Force this button to be on a new row */
  row(): AskKeyboardButton;
}

/** Function to build an inline keyboard for the `ask` helper */
export type AskKeyboardBuilder = (keyboard: AskKeyboard) => void;

/** Keyboard builder interface for conversations */
export interface AskKeyboard {
  /** Add a button to the keyboard */
  button(text: string): AskKeyboardButton;
}

/** Definition for a form field in a multi-step conversation */
export interface FormFieldDefinition<K extends string = string> {
  /** Field name in the resulting object */
  name: K;
  /** Question to ask the user */
  question: string;
  /** Expected data type */
  type: AskFieldType;
}

/** Helper provided to actions to manage conversations */
export interface ConversationHelper {
  /** 
   * Ask for input from the user.
   * Defaults to text input if no options are provided.
   */
  ask<T = string>(question: string, options?: AskOptions<T>): Promise<T>;
  /** Ask for a choice from a keyboard */
  ask(question: string, builder: AskKeyboardBuilder): Promise<string>;
  /** 
   * Update the current prompt with new text/buttons WITHOUT waiting for input.
   * Useful for showing results or intermediate states.
   */
  say(text: string, builder?: AskKeyboardBuilder): Promise<void>;
  /** 
   * Manually delete the current conversation prompt.
   */
  delete(): Promise<void>;
  /** Run a multi-step form collection */
  form<T extends Record<string, unknown>>(
    fields: FormFieldDefinition<Extract<keyof T, string>>[],
  ): Promise<T>;
  /** Navigate to a specific menu or the root menu */
  navigate(menu?: MenuRef): Promise<void>;
}

// ─── UI ────────────────────────────────────────────────────────────────────────

/** Helper for simple UI interactions */
export interface UIHelper {
  /** Show a temporary toast message (answerCallbackQuery) */
  toast(text: string): Promise<void>;
  /** Show an alert dialog */
  alert(text: string): Promise<void>;
}

// ─── Action ────────────────────────────────────────────────────────────────────

/** Context passed to action handlers */
export interface ActionContext<P = undefined> {
  /** Grammy context */
  ctx: TelebotContext;
  /** Custom data passed to this action */
  payload: P;
  /** Conversation manager */
  conversation: ConversationHelper;
  /** UI interaction helpers */
  ui: UIHelper;
  /** Navigate to a specific menu or the root menu */
  navigate(menu?: MenuRef): Promise<void>;
}

/** A function that handles a specific bot action */
export type ActionHandler<P = undefined> = (
  context: ActionContext<P>,
) => Promise<void> | void;

// ─── Menu / Layout ─────────────────────────────────────────────────────────────

/** A function used to conditionally show or hide elements */
export type GuardFn = (ctx: TelebotContext) => boolean | Promise<boolean>;

/** A string or a function that returns a string based on context */
export type DynamicLabel =
  | string
  | ((ctx: TelebotContext) => string);

/** Action handler for a button click */
export type ButtonActionHandler = (() => void) | ActionRef<any>;

/** A reference to a registered action */
export interface ActionRef<P = undefined> {
  __telebot_action: true;
  /** Unique action ID */
  id: string;
  /** The actual handler function */
  handler: ActionHandler<P>;
  /** Triggers that can invoke this action globally */
  triggers?: {
    commands?: string[];
    words?: string[];
    regexps?: RegExp[];
  };
  /** Add command trigger */
  command(name: string): ActionRef<P>;
  /** Add text trigger */
  word(text: string): ActionRef<P>;
  /** Add regex trigger */
  regexp(pattern: RegExp): ActionRef<P>;
}

/** Configuration for a menu button */
export interface ButtonConfig {
  /** Display text or label builder */
  label: DynamicLabel;
  /** Custom button ID */
  buttonId?: string;
  /** URL for the button */
  url?: string;
  /** If true, this button will always start a new row */
  forceRow: boolean;
  /** Condition for showing this button */
  guard?: GuardFn;
  /** Action to execute on click */
  action?: ButtonActionHandler;
  /** @internal */
  inlineHandler?: ActionHandler<any>;
  /** Submenu to open when clicked */
  submenu?: MenuRef;
  /** Custom data to pass to the action */
  payload?: Record<string, unknown>;
  /** If true, this action is triggered if no other buttons match (for text/regex) */
  isDefault?: boolean;
}

/** A reference to a registered menu */
export interface MenuRef {
  __telebot_menu: true;
  /** Unique menu ID */
  id: string;
  /** Function that defines the menu layout */
  builder: (layout: LayoutBuilderInterface, ctx: TelebotContext) => void | Promise<void>;
  /** Triggers that can open this menu globally */
  triggers?: {
    commands?: string[];
    words?: string[];
    regexps?: RegExp[];
  };
  /** Add command trigger */
  command(name: string): MenuRef;
  /** Add text trigger */
  word(text: string): MenuRef;
  /** Add regex trigger */
  regexp(pattern: RegExp): MenuRef;
}

/** Configuration for a paginated list of items */
export interface ListConfig<T> {
  /** Data items to display */
  items: T[];
  /** Number of items per page */
  itemsPerPage: number;
  /** Number of grid columns */
  columns: number;
  /** Function to render each item as a button */
  renderFn?: (item: T) => ButtonBuilderInterface;
}

/** Interface for building menu layouts */
export interface LayoutBuilderInterface {
  /** Set the menu body text */
  text(content: string): TextBuilderInterface;
  /** Set the menu header image */
  image(url: string): void;
  /** Add a button to the menu */
  button(label: DynamicLabel): ButtonBuilderInterface;
  /** Add a paginated grid of items */
  list<T>(items: T[]): ListBuilderInterface<T>;
  /** Set maximum number of buttons per row */
  maxPerRow(count: number): void;
  /** Add a button that refreshes the current menu */
  refreshButton(label: string): void;
}

/** Interface for building menu text */
export interface TextBuilderInterface {
  /** Set the parse mode for the text */
  parseAs(mode: ParseMode): TextBuilderInterface;
}

/** Interface for configuring a menu button */
export interface ButtonBuilderInterface {
  /** Set a custom button ID */
  id(value: string): ButtonBuilderInterface;
  /** Set a URL (makes it a URL button) */
  url(value: string): ButtonBuilderInterface;
  /** Force this button to be on a new row */
  row(): ButtonBuilderInterface;
  /** Set a visibility guard */
  guard(fn: GuardFn): ButtonBuilderInterface;
  /** Set an action handler */
  action(handler: ButtonActionHandler): ButtonBuilderInterface;
  /** Set a submenu to open */
  menu(ref: MenuRef): ButtonBuilderInterface;
  /** Set custom payload for the action */
  payload<P extends Record<string, unknown>>(data: P): ButtonBuilderInterface;
  /** Mark as the default action for this menu */
  default(): ButtonBuilderInterface;
}

/** Interface for configuring a paginated list */
export interface ListBuilderInterface<T> {
  /** Set items per page */
  perPage(count: number): ListBuilderInterface<T>;
  /** Set grid columns */
  columns(count: number): ListBuilderInterface<T>;
  /** Define how to render each item */
  render(fn: (item: T) => ButtonBuilderInterface): void;
}

// ─── Engine config ─────────────────────────────────────────────────────────────

/** Function for localizing strings */
export type Translator = (key: string, ctx: TelebotContext) => string;

/** Main configuration for TelebotApp */
export interface TelebotConfig {
  /** Bot token from @BotFather */
  token: string;
  /** Optional: resolve the TelebotUser from ctx (e.g., DB lookup) */
  resolveUser?: (ctx: Context) => TelebotUser | Promise<TelebotUser>;
  /** Optional: translator function for internal strings */
  translator?: Translator;
  /** Optional: custom storage for bot sessions */
  sessionStorage?: StorageAdapter<TelebotSession>;
}
