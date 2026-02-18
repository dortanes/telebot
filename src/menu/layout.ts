import type {
  LayoutBuilderInterface,
  DynamicLabel,
  ButtonBuilderInterface,
  ListBuilderInterface,
  TextBuilderInterface,
  ButtonActionHandler,
  ParseMode,
} from "../types.js";
import { ButtonBuilder } from "./button.js";
import { ListBuilder } from "./list.js";

/**
 * Describes one element inside the layout (text, button, list, refresh-button).
 * @internal
 */
export type LayoutElement =
  | { kind: "text"; content: string; parseMode?: ParseMode; replace?: Record<string, any> }
  | { kind: "image"; url: string }
  | { kind: "button"; builder: ButtonBuilder }
  | { kind: "list"; builder: ListBuilder<any> }
  | { kind: "refresh"; label: string };

/**
 * LayoutBuilder — the DSL object passed to `Telebot.menu(layout => { ... })`.
 *
 * Collects declarative descriptions and stores them. The engine
 * later compiles these into real Grammy inline keyboards and handlers.
 */
export class LayoutBuilder implements LayoutBuilderInterface {
  /** @internal */
  readonly _elements: LayoutElement[] = [];
  /** @internal */
  _currentText = "";
  /** @internal */
  _maxPerRow = 0; // 0 = no limit

  /** 
   * Set the message text above the keyboard.
   * If called multiple times, appends to the previous text.
   * @param content - The text content.
   */
  text(content: string): TextBuilderInterface {
    this._currentText = content;
    const element: Extract<LayoutElement, { kind: "text" }> = { kind: "text", content };
    this._elements.push(element);
    return new TextBuilder(element);
  }

  /**
   * Set the menu header image.
   * @param url - The image URL.
   */
  image(url: string): void {
    this._elements.push({ kind: "image", url });
  }

  /**
   * Create a button. 
   * @param label - A static string or a dynamic `(ctx) => string` function.
   */
  button(label: DynamicLabel): ButtonBuilderInterface {
    const builder = new ButtonBuilder(label);
    this._elements.push({ kind: "button", builder });
    return builder;
  }

  /**
   * Create a paginated list of items.
   * @param items - Array of items to display.
   * @param action - Optional default action for items.
   */
  list<T>(items: T[], action?: ButtonActionHandler): ListBuilderInterface<T> {
    const builder = new ListBuilder<T>(items);
    if (action) builder.action(action);
    this._elements.push({ kind: "list", builder });
    return builder;
  }

  /** 
   * Maximum number of buttons per row in the final keyboard. 
   * 0 (default) means no limit.
   */
  maxPerRow(count: number): void {
    this._maxPerRow = count;
  }

  /** 
   * Add a "refresh" button that re-renders the current menu. 
   * @param label - Button label (e.g., "🔄 Refresh").
   */
  refreshButton(label: string): void {
    this._elements.push({ kind: "refresh", label });
  }
}

/** 
 * Helper for configuring message text (e.g., parse mode).
 * @internal 
 */
export class TextBuilder implements TextBuilderInterface {
  constructor(private element: Extract<LayoutElement, { kind: "text" }>) {}

  /** Set the parse mode for this text block. */
  parseAs(mode: ParseMode): TextBuilderInterface {
    this.element.parseMode = mode;
    return this;
  }

  /** Set interpolation variables for the text */
  replace(data: Record<string, any>): TextBuilderInterface {
    this.element.replace = data;
    return this;
  }
}
