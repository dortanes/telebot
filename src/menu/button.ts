import type {
  ButtonConfig,
  ButtonBuilderInterface,
  GuardFn,
  DynamicLabel,
  ButtonActionHandler,
  MenuRef,
  ActionRef,
  ActionHandler,
} from "../types.js";

/**
 * Fluent builder for a single inline button.
 *
 * Usage (from LayoutBuilder):
 * ```ts
 * layout.button("Label")
 *   .id("unique")
 *   .row()
 *   .guard(ctx => ctx.user.isAdmin)
 *   .action(someAction)
 * ```
 */
export class ButtonBuilder implements ButtonBuilderInterface {
  /** @internal */
  readonly _config: ButtonConfig;

  /**
   * @internal Use `layout.button()` instead.
   */
  constructor(label: DynamicLabel) {
    this._config = {
      label,
      forceRow: false,
      isDefault: false,
    };
  }

  /**
   * Set a stable callback-data identifier for this button.
   * If not set, one will be generated automatically.
   */
  id(value: string): this {
    this._config.buttonId = value;
    return this;
  }

  /**
   * Set a URL for this button. Turns it into a URL button.
   */
  url(value: string): this {
    this._config.url = value;
    return this;
  }

  /**
   * Force this button onto a new row in the keyboard.
   */
  row(): this {
    this._config.forceRow = true;
    return this;
  }

  /**
   * Only show this button if the guard returns true.
   * @param fn - A synchronous or asynchronous guard function.
   */
  guard(fn: GuardFn): this {
    this._config.guard = fn;
    return this;
  }

  /**
   * Attach an action handler.
   * 
   * Accepts:
   * - An `ActionRef` (created via `Telebot.action`)
   * - An inline async/sync function
   * - A simple `() => void` for client-side only changes? (No, usually needs context)
   * 
   * @param handler - The handler to execute on click.
   */
  action(handler: ButtonActionHandler): this {
    if (typeof handler === "function") {
      if (handler.constructor.name === "AsyncFunction") {
         this._config.inlineHandler = handler as ActionHandler<any>;
         this._config.action = undefined;
      } else {
         this._config.action = handler;
         this._config.inlineHandler = undefined;
      }
    } else {
      this._config.action = handler;
      this._config.inlineHandler = undefined;
    }
    return this;
  }

  /** 
   * Open a sub-menu when this button is pressed. 
   * @param ref - The menu reference to open.
   */
  menu(ref: MenuRef): this {
    this._config.submenu = ref;
    return this;
  }

  /** 
   * Attach a typed payload to this button. 
   * The payload is serialized into the callback data and passed to the action.
   */
  payload<P extends Record<string, unknown>>(data: P): this {
    this._config.payload = data;
    return this;
  }

  /** 
   * Mark this button as the default inside its menu.
   * Default buttons are triggered if the user sends text that doesn't match any other button.
   */
  default(): this {
    this._config.isDefault = true;
    return this;
  }
}

/** 
 * Check if a value is an ActionRef.
 * @internal 
 */
export function isActionRef(value: unknown): value is ActionRef<any> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as any).__telebot_action === true
  );
}
