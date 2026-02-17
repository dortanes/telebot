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
} from "../types.js";

// ─── Ask keyboard builder (for button-based ask) ──────────────────────────────

/**
 * Internal implementation of the button in an `ask` prompt.
 * @internal
 */
class AskKeyboardButtonImpl implements AskKeyboardButton {
  text: string;
  _id?: string;

  constructor(text: string) {
    this.text = text;
  }

  /** Set the button ID (stored in callback data) */
  id(value: string): AskKeyboardButton {
    this._id = value;
    return this;
  }
}

/**
 * Internal implementation of the keyboard builder in an `ask` prompt.
 * @internal
 */
class AskKeyboardImpl implements AskKeyboard {
  buttons: AskKeyboardButtonImpl[] = [];

  /** Add a button to the prompt keyboard */
  button(text: string): AskKeyboardButton {
    const btn = new AskKeyboardButtonImpl(text);
    this.buttons.push(btn);
    return btn;
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
): ConversationHelper {
  
  const tr = (key: string, defaultText: string) => 
    translator ? translator(key, ctx) : defaultText;
  
  // Track the last bot message ID to edit it
  let lastMessageId: number | undefined = (conversation as any).session?.__telebot_last_msg_id ?? ctx.callbackQuery?.message?.message_id;
  const chatId = ctx.chat?.id;

  /**
   * Helper to edit the previous prompt or send a new message.
   * Manages the "single message" conversation flow.
   */
  async function editOrReply(text: string, keyboard?: InlineKeyboard) {
    if (lastMessageId && chatId) {
      try {
        await ctx.api.editMessageText(chatId, lastMessageId, text, { reply_markup: keyboard });
        return;
      } catch (e) {
        if ((e as any).description?.includes("message is not modified")) {
            return;
        }
      }
    }
    
    const msg = await ctx.reply(text, { reply_markup: keyboard });
    lastMessageId = msg.message_id;
    
    const conv = conversation as any;
    if (!conv.session) conv.session = {};
    conv.session.__telebot_last_msg_id = lastMessageId;
  }

  /** Internal helper to stop conversation */
  function throwCancel() {
    throw new Error("TELEBOT_CANCEL");
  }

  /**
   * Universal `ask` helper.
   * - If a builder function is passed, displays a keyboard of choices.
   * - Otherwise, waits for text/number/photo input.
   */
  async function ask(
    question: string,
    optionsOrBuilder: AskOptions<any> | AskKeyboardBuilder,
  ): Promise<any> {
    
    // Branch 1: inline-keyboard selection
    if (isFunction(optionsOrBuilder)) {
      const kb = new AskKeyboardImpl();
      optionsOrBuilder(kb);

      const inlineKb = new InlineKeyboard();
      for (const btn of kb.buttons) {
        const btnId = btn._id ?? btn.text;
        inlineKb.text(btn.text, `ask:${btnId}`);
      }
      const cancelText = tr("telebot.cancel", "🚫 Cancel");
      inlineKb.row().text(cancelText, "ask:__cancel__");

      await editOrReply(question, inlineKb);

      const cbCtx = await conversation.waitForCallbackQuery(/^ask:/, {
        otherwise: async (c) => {
            try { await c.deleteMessage(); } catch {}
            await c.answerCallbackQuery(tr("telebot.conversation.use_buttons", "Please use the buttons above."));
        },
      });
      await cbCtx.answerCallbackQuery();
      const data = cbCtx.callbackQuery.data!.replace(/^ask:/, "");
      
      if (data === "__cancel__") {
          throwCancel();
      }
      
      return data;
    }

    // Branch 2: text / number / photo input
    const opts = optionsOrBuilder as AskOptions<any>;
    const fieldType: AskFieldType = opts.type ?? "text";

    const cancelText = tr("telebot.cancel", "🚫 Cancel");
    const cancelKb = new InlineKeyboard().text(cancelText, "cancel_conversation");

    let currentPrompt = question;
    let isError = false;

    // Loop until valid input
    // eslint-disable-next-line no-constant-condition
    while (true) {
        await editOrReply(currentPrompt, cancelKb);

        if (fieldType === "photo") {
            const updateCtx = await conversation.waitFor(["message:photo", "callback_query:data"]);
            
            if (updateCtx.callbackQuery?.data === "cancel_conversation") {
                await updateCtx.answerCallbackQuery();
                throwCancel();
            }

            if (!updateCtx.message?.photo) {
                try { await updateCtx.deleteMessage(); } catch {}
                const err = opts.errorMessage ?? tr("telebot.conversation.photo_error", "Please send a photo.");
                currentPrompt = `${err}\n\n${question}`;
                isError = true;
                continue;
            }

            try { await updateCtx.deleteMessage(); } catch {}
            
            const photos = updateCtx.message.photo;
            if (photos && photos.length > 0) {
              return photos[photos.length - 1]!.file_id;
            }
        }

        // text / number
        const updateCtx = await conversation.waitFor(["message:text", "callback_query:data"]);

        if (updateCtx.callbackQuery?.data === "cancel_conversation") {
            await updateCtx.answerCallbackQuery();
            throwCancel();
        }

        if (!updateCtx.message?.text) {
            try { await updateCtx.deleteMessage(); } catch {}
            const err = opts.errorMessage ?? tr("telebot.conversation.text_error", "Please send a text message.");
            currentPrompt = `${err}\n\n${question}`;
            isError = true;
            continue;
        }
        
        try { await updateCtx.deleteMessage(); } catch {}

        const raw = updateCtx.message.text;

        if (fieldType === "number") {
            const n = Number(raw);
            if (Number.isNaN(n)) {
                const err = opts.errorMessage ?? tr("telebot.conversation.number_error", "Please send a valid number.");
                currentPrompt = `${err}\n\n${question}`;
                isError = true;
                continue;
            }
            if (opts.validate && !opts.validate(n)) {
                const err = opts.errorMessage ?? tr("telebot.conversation.invalid_error", "Invalid input. Try again.");
                currentPrompt = `${err}\n\n${question}`;
                isError = true;
                continue;
            }
            return n;
        }

        if (opts.validate && !opts.validate(raw)) {
            const err = opts.errorMessage ?? tr("telebot.conversation.invalid_error", "Invalid input. Try again.");
            currentPrompt = `${err}\n\n${question}`;
            isError = true;
            continue;
        }
        return raw;
    }
  }

  /**
   * Collected a multi-field form.
   */
  async function form<T extends Record<string, unknown>>(
    fields: FormFieldDefinition<Extract<keyof T, string>>[],
  ): Promise<T> {
    const result: Record<string, unknown> = {};
    for (const field of fields) {
      result[field.name] = await ask(field.question, {
        type: field.type,
      } as AskOptions<any>);
    }
    return result as T;
  }

  return { ask, form } as ConversationHelper;
}
