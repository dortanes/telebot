import { InlineKeyboard } from "grammy";
import type {
  TelebotContext,
  TelebotConversation,
  ConversationHelper,
  AskOptions,
  AskKeyboardBuilder,
  AskKeyboard,
  AskKeyboardButton,
  FormFieldDefinition,
  AskFieldType,
  Translator,
  ActionRef,
  MenuRef,
  ButtonActionHandler,
  ParseMode,
  SayOptions,
} from "../types.js";

// ─── Ask keyboard builder (for button-based ask) ──────────────────────────────

/**
 * Internal implementation of the button in an `ask` prompt.
 * @internal
 */
class AskKeyboardButtonImpl implements AskKeyboardButton {
  text: string;
  _id?: string;
  _url?: string;
  _action?: ButtonActionHandler;
  _menu?: MenuRef;
  _payload?: Record<string, unknown>;
  _forceRow: boolean = false;

  constructor(text: string) {
    this.text = text;
  }

  /** Set the button ID (stored in callback data) */
  id(value: string): AskKeyboardButton {
    this._id = value;
    return this;
  }

  url(value: string): AskKeyboardButton {
    this._url = value;
    return this;
  }

  action(handler: ButtonActionHandler): AskKeyboardButton {
    this._action = handler;
    return this;
  }

  menu(ref: MenuRef): AskKeyboardButton {
    this._menu = ref;
    return this;
  }

  navigate(ref: MenuRef): AskKeyboardButton {
    this._menu = ref;
    return this;
  }

  payload(data: Record<string, unknown>): AskKeyboardButton {
    this._payload = data;
    return this;
  }

  row(): AskKeyboardButton {
    this._forceRow = true;
    return this;
  }
}

/**
 * Internal implementation of the keyboard builder in an `ask` prompt.
 * @internal
 */
class AskKeyboardImpl implements AskKeyboard {
  buttons: AskKeyboardButtonImpl[] = [];
  _maxPerRow?: number;

  /** Add a button to the prompt keyboard */
  button(text: string): AskKeyboardButton {
    const btn = new AskKeyboardButtonImpl(text);
    this.buttons.push(btn);
    return btn;
  }

  /** Set maximum number of buttons per row */
  maxPerRow(count: number): void {
    this._maxPerRow = count;
  }
}

/** @internal */
function isFunction(value: unknown): value is (...args: any[]) => any {
  return typeof value === "function";
}

/**
 * Creates a ConversationHelper bound to a Grammy Conversation instance.
 * 
 * This is the runtime adapter providing `ask()` and `form()` helpers.
 * It manages message editing, input validation, and cancellation.
 * 
 * @param conversation - The grammy conversation instance.
 * @param ctx - The initial telebot context.
 * @param translator - Optional function for localizing internal strings.
 * @returns A {@link ConversationHelper} object.
 * @internal
 */
export function createConversationHelper(
  conversation: TelebotConversation,
  ctx: TelebotContext,
  translator?: Translator,
  navigate?: (menu?: any) => Promise<void>,
): ConversationHelper {
  
  const tr = (key: string, defaultText: string, options?: Record<string, any>) => 
    translator ? translator(key, ctx, options) : defaultText;
  
  // Track the last bot message ID to edit it
  let lastMessageId: number | undefined = (conversation as any).session?.__telebot_last_msg_id ?? ctx.callbackQuery?.message?.message_id;
  const chatId = ctx.chat?.id;

  /**
   * Helper to edit the previous prompt or send a new message.
   * Manages the "single message" conversation flow.
   */
  async function editOrReply(text: string, keyboard?: InlineKeyboard, parseMode?: ParseMode) {
    if (lastMessageId && chatId) {
      try {
        await ctx.api.editMessageText(chatId, lastMessageId, text, { reply_markup: keyboard, parse_mode: parseMode });
        return;
      } catch (e) {
        // If message is not modified, we are fine
        if ((e as any).description?.includes("message is not modified")) {
            return;
        }
        // If edit fails (e.g., transition from photo to text), we try to delete and send new
        try { await ctx.api.deleteMessage(chatId, lastMessageId); } catch {}
      }
    }
    
    const msg = await ctx.reply(text, { reply_markup: keyboard, parse_mode: parseMode });
    lastMessageId = msg.message_id;
    
    const conv = conversation as any;
    if (!conv.session) conv.session = {};
    conv.session.__telebot_last_msg_id = lastMessageId;
  }


  /**
   * Universal `ask` helper.
   * - If a builder function is passed, displays a keyboard of choices.
   * - Otherwise, waits for text/number/photo input.
   */
  async function ask<T = any>(
    question: string,
    optionsOrBuilder?: AskOptions<T> | AskKeyboardBuilder,
    maybeBuilder?: AskKeyboardBuilder,
  ): Promise<T | undefined> {
    
    // Normalize arguments
    let opts: AskOptions<T> = {};
    let builder: AskKeyboardBuilder | undefined;

    if (isFunction(optionsOrBuilder)) {
      builder = optionsOrBuilder;
    } else if (optionsOrBuilder) {
      opts = optionsOrBuilder;
      builder = maybeBuilder;
    }

    const translatedQuestion = tr(question, question, opts.replace);

    // Branch 1: inline-keyboard selection
    if (builder) {
      const kb = new AskKeyboardImpl();
      builder(kb);

      const inlineKb = new InlineKeyboard();
      let currentInRow = 0;

      for (const btn of kb.buttons) {
        if (btn._forceRow || (kb._maxPerRow && currentInRow >= kb._maxPerRow)) {
          inlineKb.row();
          currentInRow = 0;
        }

        const btnId = btn._id ?? btn.text;
        const btnLabel = tr(btn.text, btn.text, opts.replace);
        inlineKb.text(btnLabel, `ask:${btnId}`);
        currentInRow++;
      }
      const cancelText = tr("telebot.cancel", "🚫 Cancel");
      inlineKb.row().text(cancelText, "ask:__cancel__");

      await editOrReply(translatedQuestion, inlineKb, opts.parseMode);

      const cbCtx = await conversation.waitForCallbackQuery(/^ask:/, {
        otherwise: async (c) => {
            try { await c.deleteMessage(); } catch {}
            await c.answerCallbackQuery(tr("telebot.conversation.use_buttons", "Please use the buttons above."));
        },
      });
      await cbCtx.answerCallbackQuery();
      const data = cbCtx.callbackQuery.data!.replace(/^ask:/, "");
      
      if (data === "__cancel__") {
          await navigateTo();
          return undefined;
      }
      
      return data as any as T;
    }

    // Branch 2: text / number / photo input
    const fieldType: AskFieldType = opts.type ?? "text";

    const cancelText = tr("telebot.cancel", "🚫 Cancel");
    const cancelKb = new InlineKeyboard().text(cancelText, "cancel_conversation");

    let currentPrompt = translatedQuestion;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let isError = false;

    // Loop until valid input
    // eslint-disable-next-line no-constant-condition
    while (true) {
        await editOrReply(currentPrompt, cancelKb, opts.parseMode);

        if (fieldType === "photo") {
            const updateCtx = await conversation.waitFor(["message:photo", "callback_query:data"]);
            
            if (updateCtx.callbackQuery?.data === "cancel_conversation") {
                await updateCtx.answerCallbackQuery();
                await navigateTo();
                return undefined;
            }

            if (!updateCtx.message?.photo) {
                try { await updateCtx.deleteMessage(); } catch {}
                const err = opts.errorMessage ? tr(opts.errorMessage, opts.errorMessage, opts.replace) : tr("telebot.conversation.photo_error", "Please send a photo.");
                currentPrompt = `${err}\n\n${translatedQuestion}`;
                isError = true;
                continue;
            }

            try { await updateCtx.deleteMessage(); } catch {}
            
            const photos = updateCtx.message.photo;
            if (photos && photos.length > 0) {
              const val = photos[photos.length - 1]!.file_id;
              if (opts.validate && !(await opts.validate(val as unknown as T))) {
                const err = opts.errorMessage ? tr(opts.errorMessage, opts.errorMessage, opts.replace) : tr("telebot.conversation.invalid_error", "Invalid input. Try again.");
                currentPrompt = `${err}\n\n${translatedQuestion}`;
                isError = true;
                continue;
              }
              return val as unknown as T;
            }
        }

        // text / number
        const updateCtx = await conversation.waitFor(["message:text", "callback_query:data"]);

        if (updateCtx.callbackQuery?.data === "cancel_conversation") {
            await updateCtx.answerCallbackQuery();
            await navigateTo();
            return undefined;
        }

        if (!updateCtx.message?.text) {
            try { await updateCtx.deleteMessage(); } catch {}
            const err = opts.errorMessage ? tr(opts.errorMessage, opts.errorMessage, opts.replace) : tr("telebot.conversation.text_error", "Please send a text message.");
            currentPrompt = `${err}\n\n${translatedQuestion}`;
            isError = true;
            continue;
        }
        
        try { await updateCtx.deleteMessage(); } catch {}

        const raw = updateCtx.message.text;

        if (fieldType === "number") {
            const n = Number(raw);
            if (Number.isNaN(n)) {
                const err = opts.errorMessage ? tr(opts.errorMessage, opts.errorMessage, opts.replace) : tr("telebot.conversation.number_error", "Please send a valid number.");
                currentPrompt = `${err}\n\n${translatedQuestion}`;
                isError = true;
                continue;
            }
            if (opts.validate && !(await opts.validate(n as unknown as T))) {
                const err = opts.errorMessage ? tr(opts.errorMessage, opts.errorMessage, opts.replace) : tr("telebot.conversation.invalid_error", "Invalid input. Try again.");
                currentPrompt = `${err}\n\n${translatedQuestion}`;
                isError = true;
                continue;
            }
            return n as unknown as T;
        }

        if (opts.validate && !(await opts.validate(raw as unknown as T))) {
            const err = opts.errorMessage ? tr(opts.errorMessage, opts.errorMessage, opts.replace) : tr("telebot.conversation.invalid_error", "Invalid input. Try again.");
            currentPrompt = `${err}\n\n${translatedQuestion}`;
            isError = true;
            continue;
        }
        return raw as unknown as T;
    }
  }

  /**
   * Collected a multi-field form.
   */
  async function form<T extends Record<string, unknown>>(
    fields: FormFieldDefinition<Extract<keyof T, string>>[],
  ): Promise<T | undefined> {
    const result: Record<string, unknown> = {};
    for (const field of fields) {
      const val = await ask(field.question, {
        type: field.type,
      } as AskOptions<any>);
      if (val === undefined) return undefined;
      result[field.name] = val;
    }
    return result as T;
  }

  async function say(text: string, optionsOrBuilder?: SayOptions | AskKeyboardBuilder, maybeBuilder?: AskKeyboardBuilder) {
    let opts: SayOptions = {};
    let builder: AskKeyboardBuilder | undefined;

    if (isFunction(optionsOrBuilder)) {
      builder = optionsOrBuilder;
    } else if (optionsOrBuilder) {
      opts = optionsOrBuilder;
      builder = maybeBuilder;
    }

    const translated = tr(text, text, opts.replace);
    let kb: InlineKeyboard | undefined;

    if (builder) {
      const askKb = new AskKeyboardImpl();
      builder(askKb);
      kb = new InlineKeyboard();
      let currentInRow = 0;

      for (const btn of askKb.buttons) {
        if (btn._forceRow || (askKb._maxPerRow && currentInRow >= askKb._maxPerRow)) {
          kb.row();
          currentInRow = 0;
        }

        const label = tr(btn.text, btn.text, opts.replace);
        if (btn._url) {
          kb.url(label, btn._url);
        } else if (btn._menu) {
          kb.text(label, `n:${btn._menu.id}`);
        } else if (btn._action) {
           if (typeof btn._action === "function") {
             // In say(), inline functions don't have a stable way to be triggered 
             // because there's no loop. 
             kb.text(label, `ask_fn_say:${btn._id ?? btn.text}`);
           } else {
             const p = btn._payload;
             const pStr = p && Object.keys(p).length === 1 && "id" in p ? String(p.id) : (p ? JSON.stringify(p) : "");
             kb.text(label, `a:${btn._action.id}/:${pStr}`);
           }
        } else {
          kb.text(label, `ask:${btn._id ?? btn.text}`);
        }
        currentInRow++;
      }
    }

    await editOrReply(translated, kb, opts.parseMode);
  }

  async function deletePrompt() {
    if (lastMessageId && chatId) {
      try {
        await ctx.api.deleteMessage(chatId, lastMessageId);
      } catch (e) {
        // ignore errors if already deleted
      }
      lastMessageId = undefined;
      const conv = conversation as any;
      if (conv.session) {
        conv.session.__telebot_last_msg_id = undefined;
      }
    }
  }

  async function navigateTo(menu?: any) {
    if (navigate) {
      await navigate(menu);
    }
  }

  return { ask, form, say, delete: deletePrompt, navigate: navigateTo } as ConversationHelper;
}
