import type { Context } from "grammy";
import type { UIHelper } from "../types.js";

/**
 * Creates a UI helper bound to a callback-query context.
 * 
 * Provides methods for showing temporary feedback to the user.
 * 
 * @param ctx - The grammy context.
 * @returns A {@link UIHelper} object.
 */
export function createUIHelper(ctx: Context): UIHelper {
  return {
    /**
     * Show a temporary toast message.
     * Only works when the update is a callback query (button click).
     * @param text - The message to show.
     */
    async toast(text: string): Promise<void> {
      try {
        await ctx.answerCallbackQuery({ text, show_alert: false });
      } catch {
        // Not in a callback query context — silently ignore
      }
    },
    /**
     * Show a modal alert dialog.
     * Only works when the update is a callback query (button click).
     * @param text - The message to show.
     */
    async alert(text: string): Promise<void> {
      try {
        await ctx.answerCallbackQuery({ text, show_alert: true });
      } catch {
        // Not in a callback query context — silently ignore
      }
    },
  };
}
