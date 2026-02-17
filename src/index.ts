/**
 * @module Telebot
 * @description Main entry point for the Telebot framework.
 */

// ─── Public API ────────────────────────────────────────────────────────────────

// Main entry point
export { Telebot, TelebotApp } from "./telebot.js";

/**
 * @namespace Types
 * @description Core types and interfaces used throughout the framework.
 */
export type {
  TelebotContext,
  TelebotCallbackContext,
  TelebotConversation,
  TelebotUser,
  TelebotConfig,
  ActionRef,
  ActionHandler,
  ActionContext,
  MenuRef,
  ConversationHelper,
  UIHelper,
  AskOptions,
  AskKeyboardBuilder,
  AskKeyboard,
  AskKeyboardButton,
  FormFieldDefinition,
  AskFieldType,
  GuardFn,
  DynamicLabel,
  ButtonConfig,
  ButtonActionHandler,
  LayoutBuilderInterface,
  ButtonBuilderInterface,
  ListBuilderInterface,
  ListConfig,
} from "./types.js";

/**
 * @namespace Builders
 * @description Internal builders for menus, buttons, and actions.
 */
export { LayoutBuilder } from "./menu/layout.js";
export { ButtonBuilder } from "./menu/button.js";
export { ListBuilder } from "./menu/list.js";

/**
 * @namespace FactoryFunctions
 * @description Functions for creating framework entities.
 */
export { createMenu, compileMenu } from "./menu/menu.js";
export { createAction } from "./action/action.js";
export { createUIHelper } from "./ui/ui.js";
export { createConversationHelper } from "./conversation/conversation.js";

/**
 * @namespace Engine
 * @description Internal engine functions for installation and rendering.
 */
export { installMenu, sendMenu } from "./engine/engine.js";
