import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";

export interface ActiveFileInfo {
  path: string | null;
  workspaceFolder: string | null;
  relativePath: string | null;
  languageId: string | null;
  selection?: {
    text: string;
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
  } | null;
}

export class IpcServer {
  private server: http.Server;
  private wss: WebSocketServer;
  private port: number = 0;
  private authToken: string;
  private clients: Set<WebSocket> = new Set();
  private activeFile: ActiveFileInfo = {
    path: null,
    workspaceFolder: null,
    relativePath: null,
    languageId: null,
  };

  constructor() {
    this.authToken = crypto.randomBytes(16).toString("hex");

    this.server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/active-file") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify(this.activeFile));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    this.wss = new WebSocketServer({
      server: this.server,
      verifyClient: (info, cb) => {
        const header = info.req.headers["x-claude-code-ide-authorization"];
        if (header === this.authToken || !header) {
          cb(true);
        } else {
          cb(false, 401, "Unauthorized");
        }
      },
    });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      ws.on("message", (raw) => this.handleMessage(ws, raw));
      ws.on("close", () => this.clients.delete(ws));
      ws.on("error", () => this.clients.delete(ws));
    });
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
          this.writeLockFile();
          resolve(this.port);
        } else {
          reject(new Error("Failed to get server port"));
        }
      });
      this.server.on("error", reject);
    });
  }

  stop(): void {
    this.removeLockFile();
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    this.wss.close();
    this.server.close();
  }

  update(info: ActiveFileInfo): void {
    const foldersChanged = info.workspaceFolder !== this.activeFile.workspaceFolder;
    this.activeFile = info;
    if (foldersChanged && this.port > 0) {
      this.writeLockFile();
    }
    this.broadcastSelectionChanged(info);
  }

  getPort(): number {
    return this.port;
  }

  private handleMessage(ws: WebSocket, raw: Buffer | ArrayBuffer | Buffer[]): void {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.method === "initialize") {
      this.sendJsonRpc(ws, msg.id ?? 1, {
        protocolVersion: "2025-11-25",
        serverInfo: { name: "magic-terminal", version: "0.0.1" },
      });
      return;
    }

    if (msg.method === "notifications/initialized") {
      if (this.activeFile.path) {
        this.sendSelectionChanged(ws);
      }
      return;
    }
  }

  private sendJsonRpc(ws: WebSocket, id: number | string | null, result: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
    }
  }

  private sendSelectionChanged(target?: WebSocket): void {
    if (!this.activeFile.path) { return; }

    const sel = this.activeFile.selection;
    const ranges = [
      {
        text: sel?.text ?? "",
        selection: {
          start: { line: sel?.startLine ?? 0, character: sel?.startCharacter ?? 0 },
          end: { line: sel?.endLine ?? 0, character: sel?.endCharacter ?? 0 },
        },
      },
    ];

    const payload = {
      method: "selection_changed",
      params: {
        filePath: this.activeFile.path,
        source: "websocket" as const,
        ranges,
      },
    };

    const clients = target ? [target] : [...this.clients];
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ jsonrpc: "2.0", ...payload }));
      }
    }
  }

  private broadcastSelectionChanged(info: ActiveFileInfo): void {
    if (info.path) {
      this.sendSelectionChanged();
    }
  }

  private lockFilePath(): string {
    return path.join(os.homedir(), ".claude", "ide", `${this.port}.lock`);
  }

  private writeLockFile(): void {
    const filePath = this.lockFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const workspaceFolders: string[] = [];
    if (this.activeFile.workspaceFolder) {
      workspaceFolders.push(this.activeFile.workspaceFolder);
    }

    const data = {
      transport: "ws",
      authToken: this.authToken,
      workspaceFolders,
    };

    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, filePath);
  }

  private removeLockFile(): void {
    try {
      const filePath = this.lockFilePath();
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath);
      }
    } catch {
      // ignore
    }
  }
}
