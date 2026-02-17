import { Bot, InlineKeyboard, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import type {
  TelebotSession,
  TelebotContext,
  TelebotConversation,
  TelebotConfig,
  MenuRef,
  ActionRef,
  ButtonConfig,
  GuardFn,
  ParseMode,
  Translator,
} from "../types.js";
import { LayoutBuilder, type LayoutElement } from "../menu/layout.js";
import { ButtonBuilder, isActionRef } from "../menu/button.js";
import type { ListBuilder } from "../menu/list.js";
import { createConversationHelper } from "../conversation/conversation.js";
import { createUIHelper } from "../ui/ui.js";

// ─── Pagination state (in-memory, per-chat, per-menu-list) ────────────────────

/** 
 * Maps `chatId:menuId:listIdx` to the current page number.
 * @internal 
 */
const pageState = new Map<string, number>(); 

/** @internal */
function pageKey(chatId: number, menuId: string, listIdx: number): string {
  return `${chatId}:${menuId}:${listIdx}`;
}

// ─── Resolve dynamic label ─────────────────────────────────────────────────────

/** @internal */
function resolveLabel(config: ButtonConfig, ctx: TelebotContext, translator?: Translator): string {
  if (typeof config.label === "function") {
    return config.label(ctx);
  }
  return translator ? translator(config.label, ctx) : config.label;
}

// ─── Check guard ───────────────────────────────────────────────────────────────

/** @internal */
async function passesGuard(guard: GuardFn | undefined, ctx: TelebotContext): Promise<boolean> {
  if (!guard) return true;
  return guard(ctx);
}

// ─── Collect all ActionRefs and MenuRefs recursively ───────────────────────────

interface CollectedMenu {
  ref: MenuRef;
  layout: LayoutBuilder;
  parent?: string; // parent menu id for "back" navigation
}

function resolveStableId(menuId: string, cfg: ButtonConfig, index: number): string {
  if (cfg.buttonId) return `act_${cfg.buttonId}`;
  return `act_${menuId}_${index}`;
}

function collectMenuTree(
  rootRef: MenuRef,
  menus: Map<string, CollectedMenu>,
  actions: Map<string, ActionRef<any>>,
  parentId?: string,
): void {
  if (menus.has(rootRef.id)) return;

  const layout = new LayoutBuilder();
  rootRef.builder(layout);
  menus.set(rootRef.id, { ref: rootRef, layout, parent: parentId });

  // Use a snapshot to avoid infinite loops if we were rendering (though here we just scan)
  let btnIndex = 0;
  for (const el of [...layout._elements]) {
    if (el.kind === "button") {
      const cfg = el.builder._config;
      if (cfg.action && isActionRef(cfg.action)) {
        actions.set(cfg.action.id, cfg.action);
      } else if (cfg.inlineHandler) {
        // Register inline handler with stable ID
        const id = resolveStableId(rootRef.id, cfg, btnIndex);
        actions.set(id, {
          id,
          handler: cfg.inlineHandler,
          __telebot_action: true,
          command() { return this; },
          word() { return this; },
          regexp() { return this; },
        });
      }

      if (cfg.submenu) {
        collectMenuTree(cfg.submenu, menus, actions, rootRef.id);
      }
      btnIndex++;
    }
    if (el.kind === "list") {
      // Create a dummy item to find out if the render function produces actions
      const listBuilder = el.builder as ListBuilder<any>;
      if (listBuilder._config.renderFn && listBuilder._config.items.length > 0) {
        // We warn: resolving actions from dynamic lists is best-effort during collection
        // True runtime resolution happens when the button is actually clicked
        const msg = "Note: Actions inside dynamic lists are registered lazily.";
        // Ideally we should dry-run the render, but we can't easily without context.
        // For now, we rely on the fact that most actions are reused or declared statically.
        // If an action is ONLY used in a list, we might miss it here?
        // Fix: Render the first item to see what action it uses.
        try {
          // We can't render without modifying layout, but we can ignore modifications here
          const dummyItem = listBuilder._config.items[0];
          const btn = listBuilder._config.renderFn(dummyItem) as ButtonBuilder;
          // The renderFn likely pushed to `layout`, but since we iterate a snapshot, it's explicitly safe.
          if (btn._config.action && isActionRef(btn._config.action)) {
             actions.set(btn._config.action.id, btn._config.action);
          }
        } catch {
          // Ignore render errors during scan
        }
      }
    }
  }
}

// ─── Build inline keyboard for a menu ──────────────────────────────────────────

async function buildKeyboard(
  menuId: string,
  layout: LayoutBuilder,
  ctx: TelebotContext,
  chatId: number,
  translator?: (key: string, ctx: TelebotContext) => string,
  backToMenuId?: string,
): Promise<{ text: string; keyboard: InlineKeyboard; parseMode?: ParseMode; imageUrl?: string }> {
  const keyboard = new InlineKeyboard();
  let text = "";
  let imageUrl: string | undefined;
  let parseMode: ParseMode | undefined;
  const maxPerRow = layout._maxPerRow;
  let currentRowCount = 0;
  let listIdx = 0;
  let btnIndex = 0;

  // 1. Pre-scan: Find default tab and run its action (to populate text)
  // We do this BEFORE snapshotting so the text element is included in iteration
  for (const el of layout._elements) {
    if (el.kind === "button" && el.builder._config.isDefault) {
      const cfg = el.builder._config;
      // If it's a tab action (not a nav/act/link), run it
      if (cfg.action && !isActionRef(cfg.action)) {
          (cfg.action as () => void)();
      }
      break; 
    }
  }

  // 2. Snapshot: Capture elements (including the newly added text from tab action)
  const snapshotElements = [...layout._elements];

  for (const el of snapshotElements) {
    switch (el.kind) {
      case "text": {
        text = translator ? translator(el.content, ctx) : el.content;
        parseMode = el.parseMode;
        break;
      }

      case "image": {
        imageUrl = el.url;
        break;
      }

      case "button": {
        const cfg = el.builder._config;
        // Capture stable index based on layout order (regardless of visibility)
        const myIndex = btnIndex++;

        if (!(await passesGuard(cfg.guard, ctx))) break;

        const label = resolveLabel(cfg, ctx, translator);
        const btnId = cfg.buttonId ?? label;

        if (cfg.forceRow || (maxPerRow > 0 && currentRowCount >= maxPerRow)) {
          keyboard.row();
          currentRowCount = 0;
        }

        // Determine callback data
        let cbData: string;
        if (cfg.url) {
          keyboard.url(label, cfg.url);
          currentRowCount++;
          break; // URL buttons don't have callback data
        } else if (cfg.inlineHandler) {
          // Use stable ID for inline conversational action
          const id = resolveStableId(menuId, cfg, myIndex);
          const payloadStr = cfg.payload ? JSON.stringify(cfg.payload) : "";
          cbData = `act:${id}__m__${menuId}:${payloadStr}`;
        } else if (cfg.submenu) {
          cbData = `nav:${cfg.submenu.id}`;
        } else if (cfg.action && isActionRef(cfg.action)) {
          const payloadStr = cfg.payload ? JSON.stringify(cfg.payload) : "";
          cbData = `act:${cfg.action.id}__m__${menuId}:${payloadStr}`;
        } else if (cfg.action && !isActionRef(cfg.action)) {
          // Tab-style inline action (sync)
          cbData = `tab:${menuId}:${btnId}`;
        } else {
          cbData = `noop:${menuId}:${btnId}`;
        }

        // Mark active tab visually if possible? 
        // Example: add brackets or checkmark?
        // User didn't ask for it, but scenarios often implies it. 
        // For now keep label as is.
        keyboard.text(label, cbData);
        currentRowCount++;
        break;
      }

      case "list": {
        const listBuilder = el.builder as ListBuilder<any>;
        const lcfg = listBuilder._config;
        if (!lcfg.renderFn) break;

        const pk = pageKey(chatId, menuId, listIdx);
        const currentPage = pageState.get(pk) ?? 0;
        const totalPages = Math.ceil(lcfg.items.length / lcfg.itemsPerPage);
        const startIdx = currentPage * lcfg.itemsPerPage;
        const pageItems = lcfg.items.slice(startIdx, startIdx + lcfg.itemsPerPage);

        // Reset row for list items
        if (currentRowCount > 0) {
            keyboard.row();
            currentRowCount = 0;
        }

        let colCount = 0;
        for (const item of pageItems) {
          if (colCount > 0 && colCount >= lcfg.columns) {
            keyboard.row();
            colCount = 0;
          }
          const btn = lcfg.renderFn(item) as ButtonBuilder;
          const bcfg = btn._config;
          const label = resolveLabel(bcfg, ctx, translator);
          const btnId = bcfg.buttonId ?? label;

          let cbData: string;
          if (bcfg.action && isActionRef(bcfg.action)) {
            const payloadStr = bcfg.payload ? JSON.stringify(bcfg.payload) : "";
            cbData = `act:${bcfg.action.id}__m__${menuId}:${payloadStr}`;
          } else {
            cbData = `noop:${menuId}:${btnId}`;
          }
          keyboard.text(label, cbData);
          colCount++;
        }

        // Pagination controls
        if (totalPages > 1) {
          keyboard.row();
          if (currentPage > 0) {
            keyboard.text("⬅️", `page:${menuId}:${listIdx}:${currentPage - 1}`);
          }
          keyboard.text(`${currentPage + 1}/${totalPages}`, `noop:${menuId}:page-info`);
          if (currentPage < totalPages - 1) {
            keyboard.text("➡️", `page:${menuId}:${listIdx}:${currentPage + 1}`);
          }
        }

        listIdx++;
        keyboard.row();
        currentRowCount = 0;
        break;
      }

      case "refresh": {
        keyboard.row();
        const label = translator ? translator(el.label, ctx) : el.label;
        keyboard.text(label, `refresh:${menuId}`);
        currentRowCount = 0;
        break;
      }
    }
  }

  // Always append back button if parent exists
  if (backToMenuId) {
    keyboard.row();
    const backText = translator ? translator("telebot.back", ctx) : "◀️ Back";
    keyboard.text(backText, `nav:${backToMenuId}`);
  }

  return { text: text || "Menu", keyboard, parseMode, imageUrl };
}




// ─── Engine ────────────────────────────────────────────────────────────────────

/**
 * Installs the Telebot engine onto a Grammy bot.
 * 
 * - Registers session and conversation plugins.
 * - Resolves and registers all menus and actions.
 * - Sets up text and callback query handlers.
 * 
 * @param bot - The grammy bot instance.
 * @param rootRef - The root menu of the bot.
 * @param config - Framework configuration.
 */
export function installMenu(
  bot: Bot<TelebotContext>,
  rootRef: MenuRef,
  config: TelebotConfig,
): void {
  const menus = new Map<string, CollectedMenu>();
  const actions = new Map<string, ActionRef<any>>();
  collectMenuTree(rootRef, menus, actions);

  // 1. Install Session Middleware (Required for Conversations)
  bot.use(session<TelebotSession, TelebotContext>({
    initial: () => ({ 
      conversation: {}, 
      originMenuId: undefined,
      __telebot_payload: undefined, // Explicitly include for persistence safety
    } as any),
    storage: config.sessionStorage,
  }));

  // 1.5. Middleware: resolve user (Moved to prevent undefined ctx.user in guards/conversations)
  bot.use(async (ctx, next) => {
    if (config.resolveUser) {
      ctx.user = await config.resolveUser(ctx);
    } else {
      ctx.user = ctx.user ?? {};
    }
    await next();
  });

  // 2. Install Conversations Plugin (Injects ctx.conversation)
  bot.use(conversations());

  // 3. Register Action Handlers as Conversations (MUST BE REGISTERED BEFORE usage in middleware below)
  for (const [actionId, actionRef] of actions) {
    const convBuilder = async (
      conversation: TelebotConversation,
      ctx: TelebotContext,
    ) => {
      // 1. Resolve payload
      // Priority: 
      // A. Replay session (already persisted)
      // B. Context session (first run trigger)
      // C. Context match (first run regex trigger)
      // D. Callback data (first run button trigger)
      // E. Manual re-matching (last resort fallback)

      let payload = (conversation as any).session?.__telebot_payload;

      if (payload === undefined) {
        const session = ctx.session as any;
        if (session?.__telebot_payload !== undefined) {
          payload = session.__telebot_payload;
        }
      }

      if (payload === undefined && ctx.match && Array.isArray(ctx.match) && ctx.match.length > 1) {
        const val = ctx.match[1];
        payload = { id: parseInt(val, 10) || val };
      }

      if (payload === undefined && ctx.message?.text && actionRef.triggers?.regexps) {
        for (const re of actionRef.triggers.regexps) {
          const m = ctx.message.text.match(re);
          if (m && m.length > 1) {
            const val = m[1];
            payload = { id: parseInt(val, 10) || val };
            break;
          }
        }
      }

      if (payload === undefined && ctx.callbackQuery?.data?.startsWith("act:")) {
         const parts = ctx.callbackQuery.data.split("__m__");
         if (parts.length > 1) {
             const rest = parts[1];
             const colonIdx = rest.indexOf(":");
             const payloadStr = colonIdx !== -1 ? rest.slice(colonIdx + 1) : "";
             if (payloadStr) {
                try { payload = JSON.parse(payloadStr); } catch {}
             }
         }
      }

      // 2. Persist found payload to conversation session for future replays
      if (payload !== undefined) {
        const convSession = (conversation as any).session;
        if (convSession) {
          if (convSession.__telebot_payload === undefined) {
            convSession.__telebot_payload = payload;
          }
        } else {
          (conversation as any).session = { __telebot_payload: payload };
        }
      }

      const conversationHelper = createConversationHelper(conversation, ctx, config.translator);
      const uiHelper = createUIHelper(ctx);

      try {
        await actionRef.handler({
          ctx,
          payload: payload || ({} as any), // Fallback to empty object to prevent crash on destructuring
          conversation: conversationHelper,
          ui: uiHelper,
        });
      } catch (e) {
        if ((e as Error).message === "TELEBOT_CANCEL") {
          // Navigate back to origin menu if possible
          await conversation.external(async (c) => {
              if (c.session.originMenuId) {
                 await renderMenu(c.session.originMenuId, c, c.chat!.id, true);
              } else {
                 // started from text trigger - delete the prompt message if we have its ID
                 const msgId = (conversation as any).session?.__telebot_last_msg_id;
                 if (msgId && c.chat) {
                    try { await c.api.deleteMessage(c.chat.id, msgId); } catch {}
                 }
              }
          });
          return;
        }
        throw e;
      }
    };

    const convId = `telebot_${actionId}`;
    try {
        bot.use(createConversation(convBuilder, { id: convId }));
    } catch (e) {
        console.error(`Telebot Error: Failed to register conversation ${convId}`, e);
    }
  }

  // 4. Pre-check logic for Actions to trigger Conversation Middleware
  // This middleware intercept `act:` callbacks and manually flags the conversation
  // so that when the specific `createConversation` middleware runs next, it picks it up immediately.
  bot.use(async (ctx, next) => {
    if (ctx.callbackQuery?.data && ctx.callbackQuery.data.startsWith("act:")) {
        const data = ctx.callbackQuery.data;
        const parts = data.split("__m__");
        
        let actionId: string;
        let originMenuId: string | undefined;
        
        if (parts.length > 1) {
             const left = parts[0]; 
             actionId = left.slice(4); // remove "act:"
             
             const right = parts[1];
             const colonIdx = right.indexOf(":");
             if (colonIdx !== -1) {
                 originMenuId = right.slice(0, colonIdx);
             } else {
                 originMenuId = right;
             }
        } else {
             actionId = data.slice(4);
        }
        
        if (originMenuId === "undefined") originMenuId = undefined;
        if (ctx.session) ctx.session.originMenuId = originMenuId;
        
        const conversationId = `telebot_${actionId}`;
        try {
          await ctx.conversation.enter(conversationId);
        } catch (e) {
          console.error(`Telebot Error: Failed to enter conversation ${conversationId}:`, e);
          await ctx.answerCallbackQuery("Action prevented. See logs.");
          await renderMenu(rootRef.id, ctx, ctx.chat!.id);
          return;
        }
    }
    await next();
  });

  // 5. Register Text Triggers (Commands, Words, Regexps)
  
  // Helper to enter action conversation
  const enterAction = async (ctx: TelebotContext, actionId: string, payload?: any) => {
    if (ctx.session) {
      ctx.session.originMenuId = undefined; // Triggered via text, no origin menu
      // Store payload in session temporarily so the conversation builder can access it
      // @ts-ignore: custom property for internal use
      ctx.session.__telebot_payload = payload;
    }
    await ctx.conversation.enter(`telebot_${actionId}`);
    return true; // Mark as handled
  };

  // Actions
  for (const [actionId, actionRef] of actions) {
    if (!actionRef.triggers) continue;
    const { commands, words, regexps } = actionRef.triggers;

    if (commands) {
      for (const cmd of commands) {
        bot.command(cmd, async (ctx) => { if (await enterAction(ctx as TelebotContext, actionId)) return; });
      }
    }
    if (words) {
      for (const word of words) {
        bot.hears(word, async (ctx) => { if (await enterAction(ctx as TelebotContext, actionId)) return; });
      }
    }
    if (regexps) {
      for (const re of regexps) {
        bot.hears(re, async (ctx) => {
          const match = ctx.match;
          let payload: any = undefined;
          if (match && match.length > 1) {
            payload = { id: parseInt(match[1], 10) || match[1] };
          }
          if (await enterAction(ctx as TelebotContext, actionId, payload)) return;
        });
      }
    }
  }

  // Menus
  for (const [menuId, collected] of menus) {
    if (!collected.ref.triggers) continue;
    const { commands, words, regexps } = collected.ref.triggers;

    const showMenu = async (ctx: TelebotContext) => {
      await renderMenu(menuId, ctx, ctx.chat!.id);
    };

    if (commands) {
      for (const cmd of commands) {
        bot.command(cmd, (ctx) => showMenu(ctx as TelebotContext));
      }
    }
    if (words) {
      for (const word of words) {
        bot.hears(word, (ctx) => showMenu(ctx as TelebotContext));
      }
    }
    if (regexps) {
      for (const re of regexps) {
        bot.hears(re, (ctx) => showMenu(ctx as TelebotContext));
      }
    }
  }

  // 6. Generic Menu Renderer Logic (Navigation, Pagination, Tabs, Refresh)

  async function renderMenu(menuId: string, ctx: TelebotContext, chatId: number, edit: boolean = false, prebuiltLayout?: LayoutBuilder) {
      const menu = menus.get(menuId);
      if (!menu) {
          if (edit) await ctx.answerCallbackQuery("Menu not found");
          return;
      }
      
      const freshLayout = prebuiltLayout ?? new LayoutBuilder();
      if (!prebuiltLayout) {
        const builder = menu.ref.builder; 
        builder(freshLayout); 
      }
  
      const { text, keyboard, parseMode, imageUrl } = await buildKeyboard(menuId, freshLayout, ctx, chatId, config.translator, menu.parent);
      
      const isPhotoMessage = !!ctx.callbackQuery?.message && "photo" in ctx.callbackQuery.message;

      if (edit) {
        try {
            if (imageUrl) {
              if (isPhotoMessage) {
                // Edit existing photo message
                await ctx.editMessageMedia(
                  { type: "photo", media: imageUrl, caption: text, parse_mode: parseMode },
                  { reply_markup: keyboard }
                );
              } else {
                // Transition: Text -> Photo (Delete and send new)
                try { await ctx.deleteMessage(); } catch {}
                await ctx.replyWithPhoto(imageUrl, { caption: text, reply_markup: keyboard, parse_mode: parseMode });
              }
            } else {
              if (isPhotoMessage) {
                // Transition: Photo -> Text (Delete and send new)
                try { await ctx.deleteMessage(); } catch {}
                await ctx.reply(text, { reply_markup: keyboard, parse_mode: parseMode });
              } else {
                // Regular text edit
                await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: parseMode });
              }
            }
        } catch (e) {
            // ignore "not modified" or other edit errors during navigation
        }
      } else {
        if (imageUrl) {
          await ctx.replyWithPhoto(imageUrl, { caption: text, reply_markup: keyboard, parse_mode: parseMode });
        } else {
          await ctx.reply(text, { reply_markup: keyboard, parse_mode: parseMode });
        }
      }
  }

  // /start command
  bot.command("start", async (ctx) => {
    const active = await ctx.conversation.active();
    if (Object.keys(active).length > 0) return;

    if (ctx.session) ctx.session.conversation = {};
    const chatId = ctx.chat!.id;
    await renderMenu(rootRef.id, ctx as TelebotContext, chatId, false);
  });

  bot.on("message", async (ctx) => {
      const active = await ctx.conversation.active();
      if (Object.keys(active).length > 0) return;
      
      if (ctx.chat.type === "private") {
        await renderMenu(rootRef.id, ctx as TelebotContext, ctx.chat.id, false);
      }
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data.startsWith("act:")) {
        const active = await ctx.conversation.active();
        if (Object.keys(active).length > 0) return;
        await ctx.answerCallbackQuery();
        return;
    }

    if (data.startsWith("nav:")) {
      const targetMenuId = data.slice(4);
      const chatId = ctx.chat!.id;
      await renderMenu(targetMenuId, ctx as TelebotContext, chatId, true);
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("page:")) {
      const parts = data.split(":");
      const menuIdStr = parts[1]!;
      const listIdxStr = parts[2]!;
      const newPage = parseInt(parts[3]!, 10);
      const chatId = ctx.chat!.id;
      
      pageState.set(pageKey(chatId, menuIdStr, parseInt(listIdxStr, 10)), newPage);
      await renderMenu(menuIdStr, ctx as TelebotContext, chatId, true);
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("refresh:")) {
      const menuIdStr = data.slice(8);
      const chatId = ctx.chat!.id;
      await renderMenu(menuIdStr, ctx as TelebotContext, chatId, true);
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("tab:")) {
       const parts = data.split(":");
       const menuIdStr = parts[1]!;
       const tabBtnId = parts.slice(2).join(":");
       const menu = menus.get(menuIdStr);
       if (!menu) return;

       const freshLayout = new LayoutBuilder();
       menu.ref.builder(freshLayout);

       for (const el of freshLayout._elements) {
         if (el.kind === "button") {
           const cfg = el.builder._config;
           const btnId = cfg.buttonId ?? (typeof cfg.label === "string" ? cfg.label : "");
           
           if (btnId === tabBtnId) {
             cfg.isDefault = true; 
           } else if (cfg.isDefault) {
             cfg.isDefault = false; 
           }
         }
       }
       
       const chatId = ctx.chat!.id;
       await renderMenu(menuIdStr, ctx as TelebotContext, chatId, true, freshLayout);
       await ctx.answerCallbackQuery();
       return;
    }

    if (data.startsWith("noop:")) {
      await ctx.answerCallbackQuery();
      return;
    }
    
    await ctx.answerCallbackQuery();
  });
}

/**
 * Sends a specific menu to a chat programmatically.
 * 
 * @param bot - The grammy bot instance.
 * @param chatId - Target chat ID.
 * @param menuRef - The menu to send.
 * @param ctx - Current telebot context.
 */
export async function sendMenu(
  bot: Bot<TelebotContext>,
  chatId: number,
  menuRef: MenuRef,
  ctx: TelebotContext,
  translator?: Translator,
): Promise<void> {
  const layout = new LayoutBuilder();
  menuRef.builder(layout);
  const { text, keyboard, parseMode, imageUrl } = await buildKeyboard(menuRef.id, layout, ctx, chatId, translator, undefined);
  if (imageUrl) {
    await bot.api.sendPhoto(chatId, imageUrl, { caption: text, reply_markup: keyboard, parse_mode: parseMode });
  } else {
    await bot.api.sendMessage(chatId, text, { reply_markup: keyboard, parse_mode: parseMode });
  }
}
