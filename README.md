<h1 align="center">subway cursors</h1>

<p align="center">

<img src="https://img.shields.io/badge/TypeScript-000000.svg?style=for-the-badge&logo=typescript&logoColor=white">
<img src="https://img.shields.io/badge/VSCode-000000.svg?style=for-the-badge&logo=visualstudiocode&logoColor=white">
<img src="https://img.shields.io/badge/Cursor-000000.svg?style=for-the-badge&logo=cursor&logoColor=white">
<img src="https://img.shields.io/badge/License-MIT-000000.svg?style=for-the-badge">

</p>

<p align="center">subway surfers in cursor.<br>the run starts when the AI starts thinking. it pauses the second the AI is done.</p>

<p align="center">no more reels while you wait for the agent.</p>

<p align="center">
  <img src="demo/sc-demo.gif" alt="subway cursors demo" width="720">
</p>

> `game/` is gitignored — subway surfers is DMCA-able and i don't want to eat a strike. bring your own HTML5 build, see [bring your own game](#bring-your-own-game).

## how it works

cursor's [hooks](https://cursor.com/docs/hooks) fire shell scripts on `beforeSubmitPrompt` and `afterAgentResponse`. each script `curl`s a tiny HTTP server the extension runs on `127.0.0.1:<random-port>`. the extension reveals a `WebviewPanel` with the game in an iframe and `postMessage`s `pause` / `resume` to it.

```
prompt enter ─▶ ~/.cursor/hooks.json ─▶ resume.sh ─▶ curl :PORT/api/resume ─▶ panel.reveal + iframe.postMessage('resume')
AI done      ─▶ ~/.cursor/hooks.json ─▶ pause.sh  ─▶ curl :PORT/api/pause  ─▶ iframe.postMessage('pause')
```

the actually-pauses-the-game part was the surprising one. faking `document.hidden = true` and dispatching `visibilitychange` does nothing — the subway surfers HTML5 build doesn't listen to it. but the game ships its own pause toggle, bound internally to **the Escape key**:

```js
// from the game's minified bundle
btnPause = new u.a({ icon: "icon-pause.png", key: "Escape" })
onBtnPausePress() {
  this.game.state === a.a.PAUSED
    ? this.game.resume(3)   // resume with 3-second countdown
    : this.game.pause()
}
```

so the shim synthesises a single `KeyboardEvent('keydown', { key: 'Escape' })` and dispatches it to `document` exactly once per pause/resume call. the game's own state machine handles everything from there — including the resume countdown. our pause/resume hooks naturally alternate (prompt → AI-done → prompt → AI-done), which matches the toggle behaviour, so we don't need to track game state on our side.

dispatching to multiple targets (window + document + body), or also firing keyup, double-toggled the state and pause-then-immediately-resumed the game. **one event, one target.**

### the other gotcha

calling `panel.reveal(ViewColumn.Beside, …)` on an already-open webview panel **moves it between editor columns**, and moving forces the webview to reload — which restarts the game from the loading screen. on every prompt submission. looks exactly like the panel crashed.

fix: pass `viewColumn=undefined` for re-reveal. only the first creation specifies a column.

## install

**step 1 — clone + deps:**

```bash
git clone https://github.com/jassuwu/subway-cursors
cd subway-cursors
npm install
```

**step 2 — drop a game into `game/`.** see [bring your own game](#bring-your-own-game). without it the extension loads an empty panel.

**step 3 — build, package, install:**

```bash
npm run compile      # bundles src/ → dist/extension.js
npm run package      # produces subway-cursors-<version>.vsix
cursor --install-extension subway-cursors-<version>.vsix --force
```

reload cursor (`Cmd+Shift+P → Developer: Reload Window`). on first activation it asks once whether to install the cursor hooks at `~/.cursor/hooks.json` (user-level — works in every workspace). say yes. you can re-trigger it any time with `Subway: Install Cursor Hooks` from the command palette.

## bring your own game

`game/` is gitignored — subway surfers is DMCA-able and i don't want to eat a strike. bring your own HTML5 build; the harness doesn't care what's in there as long as `game/index.html` exists and the pause shim is patched in.

drop the files in so that `game/index.html` is the entry point:

```
game/
  index.html
  js/
  assets/
  …
```

then patch `game/index.html` so that the pause shim runs **before** the game's own scripts. paste this `<script>` block into `<head>`, before any other `<script>`:

```html
<script>
(function () {
  'use strict';

  // track every AudioContext so we can suspend audio on pause
  var liveCtxs = [];
  var OrigAC = window.AudioContext || window.webkitAudioContext;
  if (OrigAC) {
    var TrackedAC = function () {
      var ctx = arguments.length ? new OrigAC(arguments[0]) : new OrigAC();
      liveCtxs.push(ctx);
      return ctx;
    };
    TrackedAC.prototype = OrigAC.prototype;
    try {
      window.AudioContext = TrackedAC;
      window.webkitAudioContext = TrackedAC;
    } catch (e) {}
  }

  function makeEscape(type) {
    return new KeyboardEvent(type, {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
      bubbles: true, cancelable: true,
    });
  }

  function dispatchEscape() {
    // ONE target, ONE event. multiple causes double-toggle.
    document.dispatchEvent(makeEscape('keydown'));
  }

  function pauseGame() {
    dispatchEscape();
    for (var i = 0; i < liveCtxs.length; i++) {
      try { liveCtxs[i].suspend(); } catch (e) {}
    }
    try { if (window.Howler) window.Howler.mute(true); } catch (e) {}
  }
  function resumeGame() {
    dispatchEscape();
    for (var i = 0; i < liveCtxs.length; i++) {
      try { liveCtxs[i].resume(); } catch (e) {}
    }
    try { if (window.Howler) window.Howler.mute(false); } catch (e) {}
  }

  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || typeof d !== 'object') return;
    if (d.__sc === 'pause') pauseGame();
    else if (d.__sc === 'resume') resumeGame();
  });

  window.__sc_pause = pauseGame;
  window.__sc_resume = resumeGame;
})();
</script>
```

if you're embedding a different game, replace the `dispatchEscape()` call with whatever its real pause path is (a different keybinding, a button click, a JS API). the AudioContext + Howler stuff stays useful as belt-and-braces.

## use

| action | what happens |
| --- | --- |
| submit chat prompt | game panel pops open, game resumes |
| AI finishes | game pauses, focus returns to chat input |
| `Cmd+Shift+G` | manual toggle of the panel |
| `Subway: Pause` / `Subway: Resume` | command palette equivalents |
| `Subway: Toggle Pause When Agent Finishes` | turn off hook pause while you finish the tutorial (or keep playing); turn back on when you want auto-pause again |

## config

| setting | default | what it does |
| --- | --- | --- |
| `subwayCursors.viewColumn` | `Beside` | where the game panel opens on first creation |
| `subwayCursors.returnFocusToChat` | `true` | after AI finishes, return keyboard focus to the chat input |
| `subwayCursors.autoPanelOnFirstPrompt` | `true` | auto-open the panel on the first prompt of the window |
| `subwayCursors.pauseWhenAgentFinishes` | `true` | when `false`, the afterAgentResponse hook does not pause the game (e.g. finish the in-game tutorial); toggle via **Subway: Toggle Pause When Agent Finishes** |

## structure

```
src/
  extension.ts       activate / deactivate / status bar / commands
  gamePanel.ts       webview panel + iframe pause messaging
  hookServer.ts      localhost HTTP server for hook scripts → extension
  hookInstaller.ts   writes ~/.cursor/hooks.json on first run
  focusManager.ts    tries cursor's chat-focus commands in order
  workspaceId.ts     12-char hash of workspace path → per-window port file
hooks/
  resume.sh          cursor's beforeSubmitPrompt → /api/resume
  pause.sh           cursor's afterAgentResponse → /api/pause
game/                gitignored — drop your own HTML5 game here
```

## multi-window

each cursor window picks a fresh random port and writes `/tmp/subway-cursors-<sha1(workspace)>.port`. the hook scripts read `$CURSOR_PROJECT_DIR`, hash it the same way, and find the right port. two windows on different repos work independently.

## caveats

- the chat-focus command IDs aren't documented. the extension tries `composer.focusInput` → `aichat.focuschatpaneaction` → `workbench.action.chat.focusInput` and stops at the first one that exists. if none work in your build of cursor, the game still pauses — focus just stays on the panel.
- the hooks API is cursor-specific. plain VS Code doesn't fire these events, so the auto-loop won't run there — you can still toggle manually with `Cmd+Shift+G`.
- the pause shim is tuned for the poki subway surfers HTML5 build. for a different game, see _bring your own game_.

## develop

```bash
npm install
npm run watch       # esbuild watch mode
npm run compile     # one-off bundle
npm run package     # → .vsix
```

## why

the AI takes 30 seconds to think and i'm watching reels. that's the actual problem this solves. there is no other reason.

## license

[MIT](./LICENSE). the `game/` folder is yours.
