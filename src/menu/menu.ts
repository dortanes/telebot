import { randomUUID } from "node:crypto";
import type {
  LayoutBuilderInterface,
  MenuRef,
  TelebotContext,
} from "../types.js";
import { LayoutBuilder } from "./layout.js";

export { LayoutBuilder } from "./layout.js";
export { ButtonBuilder } from "./button.js";
export { ListBuilder } from "./list.js";

const globalMenus = new Set<MenuRef>();

/**
 * Returns all menus created via createMenu().
 * @internal
 */
export function getGlobalMenus(): MenuRef[] {
  return Array.from(globalMenus);
}

/**
 * Creates a MenuRef — a serializable reference to a menu definition.
 *
 * The builder function is stored and will be called when the menu
 * needs to be rendered (at compile time or on refresh).
 * 
 * @param builder - A function that defines the menu layout.
 * @param options - Optional configuration like a fixed manual ID.
 * @returns A {@link MenuRef} object.
 */
export function createMenu(
  builder: (layout: LayoutBuilderInterface, ctx: TelebotContext) => void | Promise<void>,
  options?: { id?: string },
): MenuRef {
  const ref: MenuRef = {
    __telebot_menu: true,
    id: options?.id ?? `m${randomUUID().slice(0, 6)}`,
    builder,
    triggers: {},
    /**
     * Add a command trigger to open this menu.
     * @param name - Command name (e.g., "start").
     */
    command(name: string) {
      if (!this.triggers) this.triggers = {};
      this.triggers.commands = [...(this.triggers.commands || []), name];
      return this;
    },
    /**
     * Add a word/phrase trigger to open this menu.
     * @param text - Exact text to match.
     */
    word(text: string) {
      if (!this.triggers) this.triggers = {};
      this.triggers.words = [...(this.triggers.words || []), text];
      return this;
    },
    /**
     * Add a regex trigger to open this menu.
     * @param pattern - Regular expression to match.
     */
    regexp(pattern: RegExp) {
      if (!this.triggers) this.triggers = {};
      this.triggers.regexps = [...(this.triggers.regexps || []), pattern];
      return this;
    },
  };

  globalMenus.add(ref);
  return ref;
}

/**
 * Compile a MenuRef into a LayoutBuilder (runs the builder function).
 * @internal
 */
export async function compileMenu(ref: MenuRef, ctx: TelebotContext): Promise<LayoutBuilder> {
  const layout = new LayoutBuilder();
  await ref.builder(layout, ctx);
  return layout;
}
