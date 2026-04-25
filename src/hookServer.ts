import * as http from "http";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".atlas": "text/plain",
  ".fnt": "text/plain",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".ktx": "image/ktx",
  ".basis": "application/octet-stream",
  ".astc": "application/octet-stream",
  ".pvr": "application/octet-stream",
  ".dds": "application/octet-stream",
  ".ktx2": "image/ktx2",
};

export interface HookServerEvents {
  onResume(): void | Promise<void>;
  onPause(): void | Promise<void>;
}

export interface HookServerOpts {
  gameRoot: string;
  workspaceId: string;
}

export class HookServer {
  private server?: http.Server;
  private _port?: number;
  private readonly portFile: string;

  constructor(
    private readonly events: HookServerEvents,
    private readonly opts: HookServerOpts
  ) {
    // Per-workspace port file so multiple Cursor windows don't clobber each other.
    this.portFile = `/tmp/subway-cursors-${opts.workspaceId}.port`;
  }

  get port(): number | undefined {
    return this._port;
  }

  async start(): Promise<void> {
    const port = await getAvailablePort();
    this._port = port;
    this.server = http.createServer((req, res) => this.handle(req, res));

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(port, "127.0.0.1", () => {
        try {
          fs.writeFileSync(this.portFile, String(port));
        } catch (e) {
          // not fatal — we just won't be reachable from hooks
          console.warn("[subway-cursors] could not write port file", e);
        }
        resolve();
      });
      this.server!.on("error", reject);
    });
  }

  stop(): void {
    try {
      fs.unlinkSync(this.portFile);
    } catch {
      // already gone
    }
    this.server?.close();
    this.server = undefined;
    this._port = undefined;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse) {
    let urlPath = (req.url || "/").split("?")[0].split("#")[0];
    try {
      urlPath = decodeURIComponent(urlPath);
    } catch {
      // leave as-is
    }

    if (urlPath === "/api/resume") {
      Promise.resolve(this.events.onResume()).catch((e) =>
        console.error("[subway-cursors] onResume failed", e)
      );
      respondText(res, 200, "resumed");
      return;
    }
    if (urlPath === "/api/pause") {
      Promise.resolve(this.events.onPause()).catch((e) =>
        console.error("[subway-cursors] onPause failed", e)
      );
      respondText(res, 200, "paused");
      return;
    }
    if (urlPath === "/api/health") {
      respondText(res, 200, "ok");
      return;
    }

    // Static game files.
    if (urlPath === "/") urlPath = "/index.html";
    const filePath = path.join(this.opts.gameRoot, urlPath);
    const safeRoot = path.resolve(this.opts.gameRoot);
    const safePath = path.resolve(filePath);
    if (!safePath.startsWith(safeRoot)) {
      respondText(res, 403, "Forbidden");
      return;
    }

    fs.stat(safePath, (err, stats) => {
      if (err || !stats.isFile()) {
        respondText(res, 404, "Not Found");
        return;
      }
      const ext = path.extname(safePath).toLowerCase();
      const mime = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": mime,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
      });
      const stream = fs.createReadStream(safePath);
      stream.pipe(res);
      stream.on("error", () => {
        try {
          res.writeHead(500);
          res.end("Internal Server Error");
        } catch {
          // already responded
        }
      });
    });
  }
}

function respondText(res: http.ServerResponse, code: number, body: string) {
  res.writeHead(code, {
    "Content-Type": "text/plain",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error("Failed to acquire port"));
      }
    });
    srv.on("error", reject);
  });
}
