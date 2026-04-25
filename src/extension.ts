import * as vscode from "vscode";
import * as path from "path";
import { GamePanel } from "./gamePanel";
import { HookServer } from "./hookServer";
import { HookInstaller } from "./hookInstaller";
import { focusChat } from "./focusManager";
import { workspaceId } from "./workspaceId";

let server: HookServer | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const gameRoot = path.join(context.extensionPath, "game");

  // 1. Start IPC server first so the very first hook fire can reach us.
  server = new HookServer(
    {
      onResume: async () => {
        const port = server?.port;
        if (port === undefined) return;
        const cfg = vscode.workspace.getConfiguration("subwayCursors");
        const auto = cfg.get<boolean>("autoPanelOnFirstPrompt", true);
        if (auto || GamePanel.exists()) {
          GamePanel.createOrShow(context, port);
          GamePanel.resume();
        }
      },
      onPause: async () => {
        GamePanel.pause();
        const cfg = vscode.workspace.getConfiguration("subwayCursors");
        if (cfg.get<boolean>("returnFocusToChat", true)) {
          await focusChat();
        }
      },
    },
    { gameRoot, workspaceId: workspaceId() }
  );

  try {
    await server.start();
    console.log(`[subway-cursors] IPC listening on 127.0.0.1:${server.port}`);
  } catch (err) {
    console.error("[subway-cursors] IPC server failed to start", err);
    vscode.window.showErrorMessage(
      "Subway Cursors couldn't start its local IPC server. Hooks won't work."
    );
  }

  context.subscriptions.push({ dispose: () => server?.stop() });

  // 2. Status bar.
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  updateStatusBar("idle");
  statusBarItem.command = "subway-cursors.toggle";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Subscribe to game state for status bar updates.
  GamePanel.onStateChange((state) => updateStatusBar(state));

  // 3. Commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("subway-cursors.toggle", () => {
      const port = server?.port;
      if (port === undefined) {
        vscode.window.showErrorMessage(
          "Subway Cursors IPC server isn't running."
        );
        return;
      }
      GamePanel.toggle(context, port);
    }),
    vscode.commands.registerCommand("subway-cursors.resume", () => {
      const port = server?.port;
      if (port === undefined) return;
      GamePanel.createOrShow(context, port);
      GamePanel.resume();
    }),
    vscode.commands.registerCommand("subway-cursors.pause", () => {
      GamePanel.pause();
    }),
    vscode.commands.registerCommand("subway-cursors.installHooks", () =>
      HookInstaller.installInteractive(context)
    ),
    vscode.commands.registerCommand("subway-cursors.uninstallHooks", () =>
      HookInstaller.uninstallInteractive()
    )
  );

  // 4. Offer to install hooks the first time the extension boots.
  HookInstaller.maybePromptInstall(context).catch((err) => {
    console.warn("[subway-cursors] install prompt failed", err);
  });
}

export function deactivate() {
  GamePanel.dispose();
  server?.stop();
}

function updateStatusBar(state: "idle" | "playing" | "paused") {
  if (!statusBarItem) return;
  const labels: Record<typeof state, string> = {
    idle: "$(rocket) Subway",
    playing: "$(rocket) Surfing",
    paused: "$(debug-pause) Subway",
  };
  statusBarItem.text = labels[state];
  statusBarItem.tooltip = "Subway Cursors — click to toggle the game panel";
}
