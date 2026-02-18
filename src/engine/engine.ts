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
import { getGlobalActions } from "../action/action.js";
import { getGlobalMenus } from "../menu/menu.js";

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
  if (cfg.buttonId) return `a${cfg.buttonId}`;
  return `a${menuId}_${index}`;
}

async function collectMenuTree(
  rootRef: MenuRef,
  menus: Map<string, CollectedMenu>,
  actions: Map<string, ActionRef<any>>,
  parentId?: string,
): Promise<void> {
  if (menus.has(rootRef.id)) return;

  const layout = new LayoutBuilder();
  // Provide a minimal mock context for scanning (guards might fail, but we try to find actions)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockCtx: any = { user: {}, session: { conversation: {} } }; 
  await rootRef.builder(layout, mockCtx);
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
        await collectMenuTree(cfg.submenu, menus, actions, rootRef.id);
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
  translator?: Translator,
  backToMenuId?: string,
  currentPayload?: any,
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
        text = translator ? translator(el.content, ctx, el.replace) : el.content;
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
          const p = cfg.payload !== undefined ? cfg.payload : currentPayload;
          // Use button ID as payload if no payload is provided
          const pStr = p && typeof p === "object" && Object.keys(p).length === 1 && "id" in p ? String(p.id) : (p !== undefined ? JSON.stringify(p) : (cfg.buttonId || ""));
          
          // If the "menu" is actually an action, we use 'ai:' (Action Inline)
          // because these are not pre-registered as conversations during scan.
          const prefix = menuId.startsWith("a") ? "ai:" : "a:";
          cbData = `${prefix}${id}/${menuId}:${pStr}`;
        } else if (cfg.submenu) {
          cbData = `n:${cfg.submenu.id}`;
        } else if (cfg.action && isActionRef(cfg.action)) {
          const p = cfg.payload;
          // Use button ID as payload if no payload is provided
          const pStr = p && Object.keys(p).length === 1 && "id" in p ? String(p.id) : (p ? JSON.stringify(p) : (cfg.buttonId || ""));
          cbData = `a:${cfg.action.id}/${menuId}:${pStr}`;
        } else if (cfg.action && !isActionRef(cfg.action)) {
          // Tab-style inline action (sync)
          cbData = `t:${menuId}:${btnId}`;
        } else {
          cbData = `_:${menuId}:${btnId}`;
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
          // Apply default action from list if button has none
          if (!btn._config.action && !btn._config.inlineHandler && !btn._config.submenu && lcfg.action) {
            btn.action(lcfg.action);
          }
          const bcfg = btn._config;
          const label = resolveLabel(bcfg, ctx, translator);
          const btnId = bcfg.buttonId ?? label;

          let cbData: string;
          if (bcfg.action && isActionRef(bcfg.action)) {
            const p = bcfg.payload !== undefined ? bcfg.payload : currentPayload;
            // Use button ID as payload if no payload is provided
            const pStr = p && typeof p === "object" && Object.keys(p).length === 1 && "id" in p ? String(p.id) : (p !== undefined ? JSON.stringify(p) : (bcfg.buttonId || ""));
            cbData = `a:${bcfg.action.id}/${menuId}:${pStr}`;
          } else {
            cbData = `_:${menuId}:${btnId}`;
          }
          keyboard.text(label, cbData);
          colCount++;
        }

        // Pagination controls
        if (totalPages > 1) {
          keyboard.row();
          if (currentPage > 0) {
            keyboard.text("⬅️", `p:${menuId}:${listIdx}:${currentPage - 1}`);
          }
          keyboard.text(`${currentPage + 1}/${totalPages}`, `_:${menuId}:page-info`);
          if (currentPage < totalPages - 1) {
            keyboard.text("➡️", `p:${menuId}:${listIdx}:${currentPage + 1}`);
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
        keyboard.text(label, `r:${menuId}`);
        currentRowCount = 0;
        break;
      }
    }
  }

  // Always append back button if parent exists
  if (backToMenuId) {
    keyboard.row();
    const backText = translator ? translator("telebot.back", ctx) : "◀️ Back";
    keyboard.text(backText, `n:${backToMenuId}`);
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
export async function installMenu(
  bot: Bot<TelebotContext>,
  rootRef: MenuRef,
  config: TelebotConfig,
): Promise<void> {
  const menus = new Map<string, CollectedMenu>();
  const actions = new Map<string, ActionRef<any>>();
  
  // We cannot wait for initial collection here because installMenu MUST be sync
  // to be used in constructor. We'll lazy-collect or do it in start().
  // 0. Collect the menu tree (recursively find all menus and actions reachable from root)
  await collectMenuTree(rootRef, menus, actions);

  // 0.5. Register global actions and menus that might have been missed by recursive scan (orphan items)
  for (const action of getGlobalActions()) {
    if (!actions.has(action.id)) {
      actions.set(action.id, action);
    }
  }

  for (const menu of getGlobalMenus()) {
    if (!menus.has(menu.id)) {
      // For orphan menus, we don't know the parent, so parent is undefined
      // We still need a LayoutBuilder to handle it correctly in renderMenu
      const layout = new LayoutBuilder();
      menus.set(menu.id, { ref: menu, layout, parent: undefined });
    }
  }

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
      try {
        ctx.user = await config.resolveUser(ctx) ?? {};
      } catch (e) {
        console.error("[Telebot] Error in resolveUser middleware:", e);
        ctx.user = {};
      }
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

      if (payload === undefined && ctx.callbackQuery?.data?.startsWith("a:")) {
         const parts = ctx.callbackQuery.data.split("/");
         if (parts.length > 1) {
             const rest = parts[1];
             const colonIdx = rest.indexOf(":");
             const pStr = colonIdx !== -1 ? rest.slice(colonIdx + 1) : "";
             if (pStr) {
                if (pStr.startsWith("{")) {
                   try { payload = JSON.parse(pStr); } catch {}
                } else {
                   // Raw ID optimization: if it looks like a number, parse it, else keep as string
                   payload = { id: isNaN(Number(pStr)) ? pStr : Number(pStr) };
                }
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

      const navigate = async (menu?: MenuRef) => {
        const targetId = menu ? menu.id : rootRef.id;
        const targetMessageId = (conversation as any).session?.__telebot_last_msg_id;
        await conversation.external(async (c) => {
          // Re-resolve user to pick up changes made during the action (e.g. language change)
          if (config.resolveUser) {
            try {
              c.user = await config.resolveUser(c) ?? {};
            } catch (e) {
              console.error("[Telebot] Error re-resolving user during navigation:", e);
            }
          }
          await renderMenu(targetId, c, c.chat!.id, true, undefined, targetMessageId);
        });
      };

      const conversationHelper = createConversationHelper(conversation, ctx, config.translator, navigate);
      const uiHelper = createUIHelper(ctx);

      // Robust user resolution: if missing or empty, try re-resolving
      if (!ctx.user || Object.keys(ctx.user).length === 0) {
        if (config.resolveUser) {
          try {
            ctx.user = await config.resolveUser(ctx) ?? {};
          } catch (e) {
            console.error("[Telebot] Error in resolveUser inside conversation:", e);
            ctx.user = {};
          }
        } else {
          ctx.user = ctx.user ?? {};
        }
      }

      const layout = new LayoutBuilder();

      try {
        await actionRef.handler({
          ctx,
          payload: payload || ({} as any), // Fallback to empty object to prevent crash on destructuring
          id: (typeof payload === "object" && payload !== null && "id" in payload) ? String(payload.id) : String(payload !== undefined && payload !== null ? payload : ""),
          conversation: conversationHelper,
          ui: uiHelper,
          layout,
          navigate,
        });

        // If action populated the layout, render it
        if (layout._elements.length > 0) {
          const { text, keyboard, parseMode, imageUrl } = await buildKeyboard(
            actionRef.id, // Use the actual action ID so stable IDs can be re-resolved
            layout,
            ctx,
            ctx.chat!.id,
            config.translator,
            undefined, // backToMenuId
            payload, // Pass current action payload for inheritance
          );

          const messageToEdit = (conversation as any).session?.__telebot_last_msg_id ?? ctx.callbackQuery?.message?.message_id;
          const isPhotoMessage = !!ctx.callbackQuery?.message && "photo" in ctx.callbackQuery.message;

          await internalRenderLayout(
            ctx.chat!.id,
            text,
            keyboard,
            parseMode,
            imageUrl,
            ctx,
            true, // try to edit if possible
            messageToEdit,
            isPhotoMessage,
            undefined,
          );
        }
      } catch (e) {
        const err = e as Error;
        if (err.message === "TELEBOT_EXTERNAL") {
          return; // Exit silently, let next middleware take over
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
    if (ctx.callbackQuery?.data && ctx.callbackQuery.data.startsWith("a:")) {
        const data = ctx.callbackQuery.data;
        const parts = data.split("/");
        
        let actionId: string;
        let originMenuId: string | undefined;
        
        if (parts.length > 1) {
             const left = parts[0]; 
             actionId = left.slice(2); // remove "a:"
             
             const right = parts[1];
             const colonIdx = right.indexOf(":");
             if (colonIdx !== -1) {
                 originMenuId = right.slice(0, colonIdx);
             } else {
                 originMenuId = right;
             }
        } else {
             actionId = data.slice(2);
        }
        
        if (originMenuId === "" || originMenuId === "undefined") originMenuId = undefined;
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

  async function renderMenu(
    menuId: string, 
    ctx: TelebotContext, 
    chatId: number, 
    edit: boolean = false, 
    prebuiltLayout?: LayoutBuilder,
    targetMessageId?: number,
  ) {
      const menu = menus.get(menuId);
      if (!menu) {
          if (edit) {
              try { await ctx.deleteMessage(); } catch {}
          }
          await renderMenu(rootRef.id, ctx, chatId, false); // Fallback to root
          return;
      }
      
      const freshLayout = prebuiltLayout ?? new LayoutBuilder();
      if (!prebuiltLayout) {
        const builder = menu.ref.builder; 
        await builder(freshLayout, ctx); 
      }
  
      const { text, keyboard, parseMode, imageUrl } = await buildKeyboard(menuId, freshLayout, ctx, chatId, config.translator, menu.parent);
      
      const messageToEdit = targetMessageId ?? ctx.callbackQuery?.message?.message_id;
      const isPhotoMessage = !!ctx.callbackQuery?.message && "photo" in ctx.callbackQuery.message;

      await internalRenderLayout(
        chatId,
        text,
        keyboard,
        parseMode,
        imageUrl,
        ctx,
        edit,
        messageToEdit,
        isPhotoMessage,
        targetMessageId,
      );
  }

  /** @internal */
  async function internalRenderLayout(
    chatId: number,
    text: string,
    keyboard: InlineKeyboard,
    parseMode: ParseMode | undefined,
    imageUrl: string | undefined,
    ctx: TelebotContext,
    edit: boolean,
    messageToEdit: number | undefined,
    isPhotoMessage: boolean,
    targetMessageId: number | undefined,
  ) {
      if (edit && messageToEdit) {
        try {
            if (imageUrl) {
              if (isPhotoMessage && !targetMessageId) {
                // Edit existing photo message (only if it was triggered by a callback on that same message)
                await ctx.editMessageMedia(
                  { type: "photo", media: imageUrl, caption: text, parse_mode: parseMode },
                  { reply_markup: keyboard }
                );
              } else {
                // Transition or explicit target: delete and send new (or try editing media if we have ID)
                try { await ctx.api.deleteMessage(chatId, messageToEdit); } catch {}
                await ctx.replyWithPhoto(imageUrl, { caption: text, reply_markup: keyboard, parse_mode: parseMode });
              }
            } else {
              if (isPhotoMessage && !targetMessageId) {
                // Transition: Photo -> Text (Delete and send new)
                try { await ctx.deleteMessage(); } catch {}
                await ctx.reply(text, { reply_markup: keyboard, parse_mode: parseMode });
              } else {
                // Regular text edit or explicit target edit
                await ctx.api.editMessageText(chatId, messageToEdit, text, { reply_markup: keyboard, parse_mode: parseMode });
              }
            }
        } catch (e) {
            // If edit fails (e.g. message too old or type mismatch), fallback to reply
            if (!targetMessageId) {
               await ctx.reply(text, { reply_markup: keyboard, parse_mode: parseMode });
            }
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

    if (data.startsWith("a:")) {
        const active = await ctx.conversation.active();
        if (Object.keys(active).length > 0) return;
        await ctx.answerCallbackQuery();
        return;
    }

    if (data.startsWith("n:")) {
      const targetMenuId = data.slice(2);
      const chatId = ctx.chat!.id;
      await renderMenu(targetMenuId, ctx as TelebotContext, chatId, true);
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("p:")) {
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

    if (data.startsWith("r:")) {
      const menuIdStr = data.slice(2);
      const chatId = ctx.chat!.id;
      await renderMenu(menuIdStr, ctx as TelebotContext, chatId, true);
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("t:")) {
       const parts = data.split(":");
       const menuIdStr = parts[1]!;
       const tabBtnId = parts.slice(2).join(":");
       const menu = menus.get(menuIdStr);
       if (!menu) return;

       const freshLayout = new LayoutBuilder();
       await menu.ref.builder(freshLayout, ctx as TelebotContext);

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

    if (data.startsWith("ai:")) {
       // Action Inline handler: execute closure by re-running the parent action
       const parts = data.split("/");
       if (parts.length < 2) return;
       const left = parts[0].slice(3); // stableId
       const right = parts[1];
       const colonIdx = right.indexOf(":");
       const originActionId = colonIdx !== -1 ? right.slice(0, colonIdx) : right;
       const pStr = colonIdx !== -1 ? right.slice(colonIdx + 1) : "";

       let payload: any;
       if (pStr) {
         if (pStr.startsWith("{")) {
            try { payload = JSON.parse(pStr); } catch {}
         } else {
            payload = { id: isNaN(Number(pStr)) ? pStr : Number(pStr) };
         }
       }

       const action = actions.get(originActionId);
       if (!action) {
           await ctx.answerCallbackQuery("Action expired or not found.");
           return;
       }

       // We need to re-run the action to find the inline closure
       const layout = new LayoutBuilder();
       const idVal = (payload && typeof payload === "object" && "id" in payload) ? String(payload.id) : (payload !== undefined && payload !== null ? String(payload) : "");
       
       const navigate = async (menu?: MenuRef) => {
         await renderMenu(menu?.id || rootRef.id, ctx as TelebotContext, ctx.chat!.id, true);
       };

       const mockConv = { 
         session: ctx.session,
         external: (fn: any) => fn(ctx),
       } as any;
       const conversationHelper = createConversationHelper(mockConv, ctx as TelebotContext, config.translator, navigate);

       // Execute parent action purely to find the button
       await action.handler({
         ctx: ctx as TelebotContext,
         payload: payload || {},
         id: idVal,
         conversation: conversationHelper,
         ui: createUIHelper(ctx as TelebotContext),
         layout,
         navigate,
       });

       // Find the button and run its handler
       let btn;
       let bidx = 0;
       for (const el of layout._elements) {
         if (el.kind === "button") {
           const sid = resolveStableId(originActionId, el.builder._config, bidx);
           if (sid === left) {
             btn = el.builder;
             break;
           }
           bidx++;
         }
       }

       if (btn && btn._config.inlineHandler) {
         await ctx.answerCallbackQuery();
         const subLayout = new LayoutBuilder();
         await btn._config.inlineHandler({
           ctx: ctx as TelebotContext,
           payload: payload || {}, // inherit payload
           id: idVal,
           conversation: conversationHelper,
           ui: createUIHelper(ctx as TelebotContext),
           layout: subLayout,
           navigate,
         });

         // If the sub-action also populated a layout, render it!
         if (subLayout._elements.length > 0) {
            const { text, keyboard, parseMode, imageUrl } = await buildKeyboard(
              originActionId,
              subLayout,
              ctx as TelebotContext,
              ctx.chat!.id,
              config.translator,
              undefined, // backToMenuId
              payload, // Pass current action payload for inheritance
            );
            
            const messageToEdit = ctx.callbackQuery?.message?.message_id;
            const isPhotoMessage = !!ctx.callbackQuery?.message && "photo" in ctx.callbackQuery.message;

            await internalRenderLayout(
                ctx.chat!.id,
                text,
                keyboard,
                parseMode,
                imageUrl,
                ctx as TelebotContext,
                true,
                messageToEdit,
                isPhotoMessage,
                undefined,
            );
         }
       } else {
         await ctx.answerCallbackQuery();
       }
       return;
    }

    if (data.startsWith("_:")) {
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
  await menuRef.builder(layout, ctx);
  const { text, keyboard, parseMode, imageUrl } = await buildKeyboard(menuRef.id, layout, ctx, chatId, translator, undefined);
  if (imageUrl) {
    await bot.api.sendPhoto(chatId, imageUrl, { caption: text, reply_markup: keyboard, parse_mode: parseMode });
  } else {
    await bot.api.sendMessage(chatId, text, { reply_markup: keyboard, parse_mode: parseMode });
  }
}
