import { randomUUID } from "node:crypto";
import type { ActionRef, ActionHandler } from "../types.js";

const globalActions = new Set<ActionRef<any>>();

/**
 * Returns all actions created via createAction().
 * @internal
 */
export function getGlobalActions(): ActionRef<any>[] {
  return Array.from(globalActions);
}

/**
 * Creates a typed action reference.
 * 
 * Use `Telebot.action<PayloadType>(handler)` to define reusable handlers
 * that can be attached to buttons.
 * 
 * @param handler - The function that handles the action logic.
 * @returns An {@link ActionRef} object.
 */
export function createAction<P = undefined>(
  handler: ActionHandler<P>,
): ActionRef<P> {
  const ref: ActionRef<P> = {
    __telebot_action: true,
    id: `a${randomUUID().slice(0, 6)}`,
    handler,
    triggers: {},
    /**
     * Set a command trigger for this action.
     * @param name - The command name (e.g., "help").
     */
    command(name: string) {
      if (!this.triggers) this.triggers = {};
      this.triggers.commands = [...(this.triggers.commands || []), name];
      return this;
    },
    /**
     * Set a word/phrase trigger for this action.
     * @param text - The exact text to match.
     */
    word(text: string) {
      if (!this.triggers) this.triggers = {};
      this.triggers.words = [...(this.triggers.words || []), text];
      return this;
    },
    /**
     * Set a regex trigger for this action.
     * @param pattern - The regular expression to match.
     */
    regexp(pattern: RegExp) {
      if (!this.triggers) this.triggers = {};
      this.triggers.regexps = [...(this.triggers.regexps || []), pattern];
      return this;
    },
  };

  globalActions.add(ref);
  return ref;
}
