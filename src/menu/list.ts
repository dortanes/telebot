import type {
  ListConfig,
  ListBuilderInterface,
  ButtonBuilderInterface,
} from "../types.js";

/**
 * Fluent builder for a paginated, dynamic list of items rendered as buttons.
 *
 * Usage (from LayoutBuilder):
 * ```ts
 * layout.list(items)
 *   .perPage(5)
 *   .columns(1)
 *   .render(item => layout.button(`⭐ ${item.title}`).payload(...).action(...))
 * ```
 */
export class ListBuilder<T> implements ListBuilderInterface<T> {
  /** @internal */
  readonly _config: ListConfig<T>;

  /**
   * @internal Use `layout.list()` instead.
   */
  constructor(items: T[]) {
    this._config = {
      items,
      itemsPerPage: 10,
      columns: 1,
      renderFn: undefined,
    };
  }

  /** 
   * Set the number of items to show per page. 
   * Default is 10. 
   */
  perPage(count: number): this {
    this._config.itemsPerPage = count;
    return this;
  }

  /** 
   * Set the number of columns (buttons per row) for the list items. 
   * Default is 1. 
   */
  columns(count: number): this {
    this._config.columns = count;
    return this;
  }

  /**
   * Set the render callback — called once per visible item on the current page.
   * 
   * The callback must return a {@link ButtonBuilderInterface}.
   * @param fn - A function that returns a button builder for each item.
   */
  render(fn: (item: T) => ButtonBuilderInterface): void {
    this._config.renderFn = fn;
  }
}
