import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";

export interface ActiveFileInfo {
  path: string | null;
  workspaceFolder: string | null;
  selection?: {
    text: string;
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
  } | null;
}

export interface IpcServerOptions {
  lockDir?: string;
  authToken?: string;
}

export class IpcServer {
  private wss: WebSocketServer;
  private port: number = 0;
  private authToken: string;
  private lockDir: string;
  private clients: Set<WebSocket> = new Set();
  private activeFile: ActiveFileInfo = { path: null, workspaceFolder: null };

  constructor(options?: IpcServerOptions) {
    this.authToken = options?.authToken ?? crypto.randomBytes(16).toString("hex");
    this.lockDir = options?.lockDir ?? path.join(os.homedir(), ".claude", "ide");

    this.wss = new WebSocketServer({
      port: 0,
      host: "127.0.0.1",
      verifyClient: (info, cb) => {
        const header = info.req.headers["x-claude-code-ide-authorization"];
        cb(header === this.authToken || !header);
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
      this.wss.once("listening", () => {
        const addr = this.wss.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
          this.writeLockFile();
          resolve(this.port);
        } else {
          reject(new Error("Failed to get server port"));
        }
      });
      this.wss.on("error", reject);
    });
  }

  stop(): void {
    this.removeLockFile();
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    this.wss.close();
  }

  update(info: ActiveFileInfo): void {
    const foldersChanged = info.workspaceFolder !== this.activeFile.workspaceFolder;
    this.activeFile = info;
    if (foldersChanged && this.port > 0) {
      this.writeLockFile();
    }
    if (info.path) {
      this.sendSelectionChanged();
    }
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
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id ?? 1,
            result: {
              protocolVersion: "2025-11-25",
              serverInfo: { name: "magic-terminal", version: "0.0.1" },
            },
          }),
        );
      }
      return;
    }

    if (msg.method === "notifications/initialized" && this.activeFile.path) {
      this.sendSelectionChanged(ws);
    }
  }

  private sendSelectionChanged(target?: WebSocket): void {
    if (!this.activeFile.path) { return; }

    const sel = this.activeFile.selection;
    const payload = {
      jsonrpc: "2.0" as const,
      method: "selection_changed",
      params: {
        filePath: this.activeFile.path,
        source: "websocket" as const,
        ranges: [
          {
            text: sel?.text ?? "",
            selection: {
              start: { line: sel?.startLine ?? 0, character: sel?.startCharacter ?? 0 },
              end: { line: sel?.endLine ?? 0, character: sel?.endCharacter ?? 0 },
            },
          },
        ],
      },
    };

    const clients = target ? [target] : [...this.clients];
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(payload));
      }
    }
  }

  private lockFilePath(): string {
    return path.join(this.lockDir, `${this.port}.lock`);
  }

  private writeLockFile(): void {
    const filePath = this.lockFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data = {
      transport: "ws",
      authToken: this.authToken,
      workspaceFolders: this.activeFile.workspaceFolder
        ? [this.activeFile.workspaceFolder]
        : [],
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
