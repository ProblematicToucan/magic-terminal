import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { WebSocket } from "ws";
import { IpcServer } from "../ipcServer";

interface JsonRpcMessage {
  jsonrpc: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

function createTempDir(): string {
  const dir = path.join(os.tmpdir(), `magic-terminal-ipc-test-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function connect(port: number, authToken?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const url = `ws://127.0.0.1:${port}`;
    const ws = authToken
      ? new WebSocket(url, {
          headers: { "x-claude-code-ide-authorization": authToken },
        } as any)
      : new WebSocket(url);

    ws.on("open", () => resolve(ws));
    ws.on("error", reject);

    setTimeout(() => reject(new Error("WebSocket connection timeout")), 2000);
  });
}

function waitForMessage(ws: WebSocket): Promise<JsonRpcMessage> {
  return new Promise((resolve) => {
    ws.once("message", (raw) => {
      resolve(JSON.parse(raw.toString()));
    });
  });
}

function sendMessage(ws: WebSocket, msg: Record<string, unknown>): void {
  ws.send(JSON.stringify({ jsonrpc: "2.0", ...msg }));
}

suite("IpcServer", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = createTempDir();
  });

  teardown(() => {
    removeTempDir(tmpDir);
  });

  test("start returns a port and creates a lock file", async () => {
    const server = new IpcServer({ lockDir: tmpDir });
    const port = await server.start();
    assert.ok(port > 0 && port <= 65535);

    const lockFile = path.join(tmpDir, `${port}.lock`);
    assert.ok(fs.existsSync(lockFile));

    const content = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    assert.strictEqual(content.transport, "ws");
    assert.ok(typeof content.authToken === "string");
    assert.deepStrictEqual(content.workspaceFolders, []);

    server.stop();
    assert.ok(!fs.existsSync(lockFile));
  });

  test("lock file includes workspace folders", async () => {
    const server = new IpcServer({ lockDir: tmpDir, authToken: "test-token" });
    await server.start();
    server.update({ path: "/test/file.ts", workspaceFolder: "/test" });

    const lockFile = path.join(tmpDir, `${server.getPort()}.lock`);
    const content = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    assert.deepStrictEqual(content.workspaceFolders, ["/test"]);

    server.stop();
  });

  test("handles initialize JSON-RPC handshake", async () => {
    const server = new IpcServer({ lockDir: tmpDir });
    const port = await server.start();
    const ws = await connect(port);

    sendMessage(ws, { id: 1, method: "initialize", params: {} });
    const response = await waitForMessage(ws);

    assert.strictEqual(response.id, 1);
    assert.ok(response.result);
    assert.strictEqual(
      (response.result as any).protocolVersion,
      "2025-11-25",
    );
    assert.strictEqual((response.result as any).serverInfo.name, "magic-terminal");

    ws.close();
    server.stop();
  });

  test("sends selection_changed on file update", async () => {
    const server = new IpcServer({ lockDir: tmpDir });
    const port = await server.start();
    const ws = await connect(port);

    server.update({ path: "/test/foo.ts", workspaceFolder: "/test" });
    const msg = await waitForMessage(ws);

    assert.strictEqual(msg.method, "selection_changed");
    assert.strictEqual(
      (msg.params as any).filePath,
      "/test/foo.ts",
    );
    assert.strictEqual((msg.params as any).source, "websocket");

    ws.close();
    server.stop();
  });

  test("sends selection_changed with selection info", async () => {
    const server = new IpcServer({ lockDir: tmpDir });
    const port = await server.start();
    const ws = await connect(port);

    server.update({
      path: "/test/bar.ts",
      workspaceFolder: "/test",
      selection: {
        text: "selected text",
        startLine: 5,
        startCharacter: 2,
        endLine: 7,
        endCharacter: 10,
      },
    });

    const msg = await waitForMessage(ws);
    const range = (msg.params as any).ranges[0];

    assert.strictEqual(range.text, "selected text");
    assert.strictEqual(range.selection.start.line, 5);
    assert.strictEqual(range.selection.start.character, 2);
    assert.strictEqual(range.selection.end.line, 7);
    assert.strictEqual(range.selection.end.character, 10);

    ws.close();
    server.stop();
  });

  test("pushes current selection to newly initialized client", async () => {
    const server = new IpcServer({ lockDir: tmpDir });
    const port = await server.start();
    const ws = await connect(port);

    server.update({ path: "/test/init.ts", workspaceFolder: "/test" });
    await waitForMessage(ws); // discard initial broadcast

    sendMessage(ws, { method: "notifications/initialized" });
    const msg = await waitForMessage(ws);

    assert.strictEqual(msg.method, "selection_changed");
    assert.strictEqual((msg.params as any).filePath, "/test/init.ts");

    ws.close();
    server.stop();
  });

  test("does not broadcast when path is null", async () => {
    const server = new IpcServer({ lockDir: tmpDir });
    const port = await server.start();
    const ws = await connect(port);

    let messages = 0;
    ws.on("message", () => messages++);

    server.update({ path: null, workspaceFolder: null });
    await new Promise((r) => setTimeout(r, 100));

    assert.strictEqual(messages, 0);

    ws.close();
    server.stop();
  });

  test("rejects connection with wrong auth token", async () => {
    const server = new IpcServer({
      lockDir: tmpDir,
      authToken: "correct-token",
    });
    const port = await server.start();

    await assert.rejects(
      () => connect(port, "wrong-token"),
      /Unexpected server response: 401/,
    );

    server.stop();
  });

  test("accepts connection with correct auth token", async () => {
    const server = new IpcServer({
      lockDir: tmpDir,
      authToken: "correct-token",
    });
    const port = await server.start();
    const ws = await connect(port, "correct-token");

    assert.strictEqual(ws.readyState, WebSocket.OPEN);

    ws.close();
    server.stop();
  });

  test("accepts connection without auth when no token is set", async () => {
    const server = new IpcServer({ lockDir: tmpDir });
    const port = await server.start();
    const ws = await connect(port);

    assert.strictEqual(ws.readyState, WebSocket.OPEN);

    ws.close();
    server.stop();
  });

  test("broadcasts to all connected clients", async () => {
    const server = new IpcServer({ lockDir: tmpDir });
    const port = await server.start();

    const ws1 = await connect(port);
    const ws2 = await connect(port);

    const p1 = waitForMessage(ws1);
    const p2 = waitForMessage(ws2);

    server.update({ path: "/test/multi.ts", workspaceFolder: "/test" });

    const [msg1, msg2] = await Promise.all([p1, p2]);
    assert.strictEqual((msg1.params as any).filePath, "/test/multi.ts");
    assert.strictEqual((msg2.params as any).filePath, "/test/multi.ts");

    ws1.close();
    ws2.close();
    server.stop();
  });

  test("getPort returns the port", async () => {
    const server = new IpcServer({ lockDir: tmpDir });
    const port = await server.start();
    assert.strictEqual(server.getPort(), port);
    server.stop();
  });
});
