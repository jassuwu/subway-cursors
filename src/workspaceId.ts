import * as vscode from "vscode";
import * as crypto from "crypto";

/**
 * Stable 12-char hash of the active workspace folder path.
 *
 * Hooks compute the same hash from $CURSOR_PROJECT_DIR so they can find
 * the right port file when multiple Cursor windows are open.
 */
export function workspaceId(): string {
  const root =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "no-workspace";
  return crypto.createHash("sha1").update(root).digest("hex").slice(0, 12);
}
