import * as vscode from "vscode";

/**
 * Cursor doesn't expose chat events to extensions, and the chat-focus
 * command IDs aren't documented. We try a list of known/plausible ones
 * in priority order and return as soon as one succeeds.
 */
const CHAT_FOCUS_COMMANDS = [
  // Cursor (current composer)
  "composer.focusInput",
  "composer.focusChat",
  "composer.openComposerWindow",
  // Cursor (legacy aichat)
  "aichat.focuschatpaneaction",
  "aichat.newchataction",
  // VSCode Copilot Chat fallback
  "workbench.action.chat.focusInput",
  "workbench.action.chat.open",
];

export async function focusChat(): Promise<void> {
  for (const cmd of CHAT_FOCUS_COMMANDS) {
    try {
      await vscode.commands.executeCommand(cmd);
      // First success wins.
      return;
    } catch {
      // Command doesn't exist in this build — try the next.
    }
  }
  // No-op if none worked. The user will just see the game pause overlay.
}
