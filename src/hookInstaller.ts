import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const HOOKS_FILE = path.join(os.homedir(), ".cursor", "hooks.json");
const HOOKS_DIR = path.dirname(HOOKS_FILE);
const SCRIPT_DIR = path.join(HOOKS_DIR, "hooks", "subway-cursors");
const RESUME_DST = path.join(SCRIPT_DIR, "resume.sh");
const PAUSE_DST = path.join(SCRIPT_DIR, "pause.sh");

const SKIP_PROMPT_KEY = "subway-cursors.skipInstallPrompt";
const TAG = "subway-cursors";

export class HookInstaller {
  static isInstalled(): boolean {
    if (!fs.existsSync(HOOKS_FILE)) return false;
    try {
      const json = JSON.parse(fs.readFileSync(HOOKS_FILE, "utf8"));
      const before: any[] = json?.hooks?.beforeSubmitPrompt || [];
      const after: any[] = json?.hooks?.afterAgentResponse || [];
      const matches = (h: any) =>
        typeof h?.command === "string" && h.command.includes(TAG);
      return before.some(matches) && after.some(matches);
    } catch {
      return false;
    }
  }

  /**
   * On first activation, ask the user once if they want to install hooks.
   * Skips if already installed or if the user said "don't ask again".
   */
  static async maybePromptInstall(context: vscode.ExtensionContext) {
    if (HookInstaller.isInstalled()) return;
    if (context.globalState.get<boolean>(SKIP_PROMPT_KEY)) return;

    const choice = await vscode.window.showInformationMessage(
      "Subway Cursors: install Cursor hooks at ~/.cursor/hooks.json so the game auto-pauses when the AI finishes?",
      { modal: false },
      "Install",
      "Skip",
      "Don't ask again"
    );

    if (choice === "Install") {
      await HookInstaller.install(context);
    } else if (choice === "Don't ask again") {
      await context.globalState.update(SKIP_PROMPT_KEY, true);
    }
  }

  static async installInteractive(context: vscode.ExtensionContext) {
    const ok = await HookInstaller.install(context);
    if (ok) {
      vscode.window.showInformationMessage(
        `Subway Cursors hooks installed at ${HOOKS_FILE}`
      );
    }
  }

  static async uninstallInteractive() {
    const ok = await HookInstaller.uninstall();
    if (ok) {
      vscode.window.showInformationMessage(
        "Subway Cursors hooks removed from ~/.cursor/hooks.json"
      );
    }
  }

  private static async install(
    context: vscode.ExtensionContext
  ): Promise<boolean> {
    const resumeSrc = path.join(context.extensionPath, "hooks", "resume.sh");
    const pauseSrc = path.join(context.extensionPath, "hooks", "pause.sh");

    if (!fs.existsSync(resumeSrc) || !fs.existsSync(pauseSrc)) {
      vscode.window.showErrorMessage(
        `Subway Cursors: missing bundled hook scripts at ${path.dirname(
          resumeSrc
        )}`
      );
      return false;
    }

    try {
      // 1. Copy scripts into ~/.cursor/hooks/subway-cursors/
      fs.mkdirSync(SCRIPT_DIR, { recursive: true });
      fs.copyFileSync(resumeSrc, RESUME_DST);
      fs.copyFileSync(pauseSrc, PAUSE_DST);
      try {
        fs.chmodSync(RESUME_DST, 0o755);
        fs.chmodSync(PAUSE_DST, 0o755);
      } catch {
        // best effort
      }

      // 2. Read or create ~/.cursor/hooks.json
      fs.mkdirSync(HOOKS_DIR, { recursive: true });

      let hooks: any = { version: 1, hooks: {} };
      if (fs.existsSync(HOOKS_FILE)) {
        try {
          const raw = fs.readFileSync(HOOKS_FILE, "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") hooks = parsed;
        } catch {
          // Corrupt file — back it up and start fresh.
          try {
            fs.copyFileSync(HOOKS_FILE, HOOKS_FILE + ".bak");
          } catch {
            // ignore
          }
          hooks = { version: 1, hooks: {} };
        }
      }
      if (!hooks.version) hooks.version = 1;
      if (!hooks.hooks || typeof hooks.hooks !== "object") hooks.hooks = {};

      // 3. Merge our entries, removing any prior subway-cursors entries.
      const ours = (cmd: string) => ({ command: cmd, timeout: 3 });
      const filterOurs = (arr: any) =>
        Array.isArray(arr)
          ? arr.filter(
              (h: any) =>
                typeof h?.command !== "string" || !h.command.includes(TAG)
            )
          : [];

      hooks.hooks.beforeSubmitPrompt = [
        ...filterOurs(hooks.hooks.beforeSubmitPrompt),
        ours(RESUME_DST),
      ];
      hooks.hooks.afterAgentResponse = [
        ...filterOurs(hooks.hooks.afterAgentResponse),
        ours(PAUSE_DST),
      ];

      // 4. Write back.
      fs.writeFileSync(HOOKS_FILE, JSON.stringify(hooks, null, 2) + "\n");

      await context.globalState.update(SKIP_PROMPT_KEY, true);
      return true;
    } catch (e: any) {
      vscode.window.showErrorMessage(
        `Subway Cursors: failed to install hooks: ${e?.message || e}`
      );
      return false;
    }
  }

  private static async uninstall(): Promise<boolean> {
    if (!fs.existsSync(HOOKS_FILE)) return true;
    try {
      const raw = fs.readFileSync(HOOKS_FILE, "utf8");
      const hooks = JSON.parse(raw);

      const filterOurs = (arr: any) =>
        Array.isArray(arr)
          ? arr.filter(
              (h: any) =>
                typeof h?.command !== "string" || !h.command.includes(TAG)
            )
          : arr;

      if (hooks?.hooks) {
        if (hooks.hooks.beforeSubmitPrompt) {
          hooks.hooks.beforeSubmitPrompt = filterOurs(
            hooks.hooks.beforeSubmitPrompt
          );
          if (hooks.hooks.beforeSubmitPrompt.length === 0)
            delete hooks.hooks.beforeSubmitPrompt;
        }
        if (hooks.hooks.afterAgentResponse) {
          hooks.hooks.afterAgentResponse = filterOurs(
            hooks.hooks.afterAgentResponse
          );
          if (hooks.hooks.afterAgentResponse.length === 0)
            delete hooks.hooks.afterAgentResponse;
        }
      }

      fs.writeFileSync(HOOKS_FILE, JSON.stringify(hooks, null, 2) + "\n");

      // Remove our scripts directory.
      try {
        fs.rmSync(SCRIPT_DIR, { recursive: true, force: true });
      } catch {
        // ignore
      }

      return true;
    } catch (e: any) {
      vscode.window.showErrorMessage(
        `Subway Cursors: failed to uninstall hooks: ${e?.message || e}`
      );
      return false;
    }
  }
}
