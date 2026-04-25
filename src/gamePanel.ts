import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

type GameState = "idle" | "playing" | "paused";
type StateListener = (state: GameState) => void;

export class GamePanel {
  private static instance: GamePanel | undefined;
  private static stateListeners: Set<StateListener> = new Set();
  private static lastState: GameState = "idle";

  private readonly panel: vscode.WebviewPanel;
  private readonly serverPort: number;

  static onStateChange(fn: StateListener): vscode.Disposable {
    GamePanel.stateListeners.add(fn);
    fn(GamePanel.lastState);
    return new vscode.Disposable(() => GamePanel.stateListeners.delete(fn));
  }

  private static setState(s: GameState) {
    GamePanel.lastState = s;
    for (const fn of GamePanel.stateListeners) {
      try {
        fn(s);
      } catch {
        // swallow
      }
    }
  }

  static exists(): boolean {
    return !!GamePanel.instance;
  }

  static toggle(context: vscode.ExtensionContext, port: number) {
    if (GamePanel.instance) {
      GamePanel.instance.panel.dispose();
    } else {
      GamePanel.createOrShow(context, port);
    }
  }

  static createOrShow(context: vscode.ExtensionContext, port: number) {
    if (GamePanel.instance) {
      // CRITICAL: pass viewColumn=undefined here. VSCode interprets a non-
      // undefined viewColumn argument as "move the panel to that column", and
      // moving a webview between columns forces the webview to reload —
      // which restarts Subway Surfers from the loading screen and looks
      // exactly like the panel "crashed" when the user submits a prompt.
      // Reveal in place; only the FIRST creation uses the configured column.
      GamePanel.instance.panel.reveal(undefined, true /* preserveFocus */);
      return GamePanel.instance;
    }

    const gamePath = path.join(context.extensionPath, "game");
    if (!fs.existsSync(gamePath)) {
      vscode.window.showErrorMessage(
        "Subway Cursors: game/ directory missing from the extension."
      );
      return undefined;
    }

    const col = readViewColumn();
    const panel = vscode.window.createWebviewPanel(
      "subwayCursors",
      "Subway Surfers",
      { viewColumn: col, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(gamePath)],
      }
    );

    GamePanel.instance = new GamePanel(panel, port);
    return GamePanel.instance;
  }

  static resume() {
    const inst = GamePanel.instance;
    if (!inst) return;
    // Reveal in place (undefined column → don't move) and DO take focus so
    // the iframe inside the webview can grab keyboard input for the game.
    inst.panel.reveal(undefined, false);
    inst.panel.webview.postMessage({ command: "resume" });
    GamePanel.setState("playing");
  }

  static pause() {
    const inst = GamePanel.instance;
    if (!inst) return;
    inst.panel.webview.postMessage({ command: "pause" });
    GamePanel.setState("paused");
  }

  static dispose() {
    GamePanel.instance?.panel.dispose();
  }

  private constructor(panel: vscode.WebviewPanel, serverPort: number) {
    this.panel = panel;
    this.serverPort = serverPort;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => {
      GamePanel.instance = undefined;
      GamePanel.setState("idle");
    });
  }

  private getHtml(): string {
    const origin = `http://127.0.0.1:${this.serverPort}`;
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'self' ${origin};
    script-src 'unsafe-inline' 'unsafe-eval' ${origin} blob:;
    style-src 'unsafe-inline' ${origin};
    img-src ${origin} data: blob: 'self';
    media-src ${origin} data: blob:;
    font-src ${origin} data:;
    connect-src ${origin} data: blob: ws://127.0.0.1:${this.serverPort};
    worker-src ${origin} blob:;
    child-src ${origin} blob:;
    frame-src ${origin};
  ">
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #0b316b;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
    }
    #overlay {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      background: linear-gradient(180deg, rgba(11,49,107,0.85) 0%, rgba(0,0,0,0.85) 100%);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: #fff;
      z-index: 9999;
      user-select: none;
      pointer-events: none;
    }
    #overlay.visible { display: flex; }
    #overlay .tag {
      font-size: 12px;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      opacity: 0.6;
      margin-bottom: 8px;
    }
    #overlay h1 {
      font-size: 56px;
      margin: 0;
      font-weight: 800;
      letter-spacing: -1px;
      text-shadow: 0 4px 24px rgba(0,0,0,0.5);
    }
    #overlay p {
      font-size: 14px;
      opacity: 0.7;
      margin-top: 14px;
      max-width: 360px;
      text-align: center;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <iframe id="game" src="${origin}/index.html" allow="autoplay; fullscreen"></iframe>
  <!--
    The "Ready" overlay only shows before the first AI activity. After that,
    the game's own pause UI (the one that comes up on Escape) is the source
    of truth — we'd just be obscuring it.
  -->
  <div id="overlay" class="visible">
    <div class="tag">Subway Cursors</div>
    <h1>Ready</h1>
    <p>Submit a chat prompt — the game starts when the AI starts working,<br/>and pauses the moment it's done.</p>
  </div>
  <script>
    (function () {
      const overlay = document.getElementById('overlay');
      const iframe = document.getElementById('game');
      let firstActivity = true;

      function send(cmd) {
        try {
          iframe.contentWindow && iframe.contentWindow.postMessage({ __sc: cmd }, '*');
        } catch (e) {}
      }

      function dismissOverlayOnce() {
        if (!firstActivity) return;
        firstActivity = false;
        overlay.classList.remove('visible');
      }

      window.addEventListener('message', function (e) {
        const d = e.data;
        if (!d) return;
        if (d.command === 'pause') {
          dismissOverlayOnce();
          send('pause');
        } else if (d.command === 'resume') {
          dismissOverlayOnce();
          send('resume');
          // Hand keyboard focus to the iframe so arrow keys / space go to the
          // game and not the editor underneath.
          setTimeout(() => { try { iframe.focus(); } catch (e) {} }, 0);
        }
      });
    })();
  </script>
</body>
</html>`;
  }
}

function readViewColumn(): vscode.ViewColumn {
  const cfg = vscode.workspace.getConfiguration("subwayCursors");
  const name = cfg.get<string>("viewColumn", "Beside");
  switch (name) {
    case "One":
      return vscode.ViewColumn.One;
    case "Two":
      return vscode.ViewColumn.Two;
    case "Active":
      return vscode.ViewColumn.Active;
    case "Beside":
    default:
      return vscode.ViewColumn.Beside;
  }
}
