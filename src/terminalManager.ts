import * as vscode from "vscode";
import * as pty from "node-pty";
import * as fs from "fs";
import * as path from "path";

interface TerminalSession {
  id: string;
  name: string;
  ptyProcess: pty.IPty;
  backlogChunks: string[];
  backlogLength: number;
  disposables: pty.IDisposable[];
}

export class TerminalManager {
  private managedTerminals: Map<string, TerminalSession> = new Map();
  private activeTerminalId: string | null = null;
  private changeCallback: (() => void) | null = null;
  private dataCallback: ((terminalId: string, data: string) => void) | null = null;
  private terminalCounter = 0;
  private ipcPort: number | null = null;

  setIpcPort(port: number | null): void {
    this.ipcPort = port;
  }

  onChange(cb: () => void): void {
    this.changeCallback = cb;
  }

  onData(cb: (terminalId: string, data: string) => void): void {
    this.dataCallback = cb;
  }

  createTerminal(name?: string): string {
    this.terminalCounter++;
    const id = `terminal-${this.terminalCounter}`;
    const displayName = name || `Terminal ${this.terminalCounter}`;

    const shell = this.getShellPath();
    const cwd = path.resolve(this.getWorkspaceFolder());

    const env: Record<string, string> = {
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    };

    // Copy only safe environment variables — strip VS Code / Electron
    // injected vars that trigger shell integration scripts
    for (const key of Object.keys(process.env)) {
      if (
        key === 'TERM_PROGRAM' ||
        key === 'TERM_PROGRAM_VERSION' ||
        key.startsWith('VSCODE_') ||
        key.startsWith('ELECTRON_')
      ) {
        continue;
      }
      const val = process.env[key];
      if (val !== undefined) {
        env[key] = val;
      }
    }

    if (this.ipcPort !== null) {
      env["MAGIC_TERMINAL_IPC"] = String(this.ipcPort);
    }

    const ptyProcess = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env,
    });

    const session: TerminalSession = {
      id,
      name: displayName,
      ptyProcess,
      backlogChunks: [],
      backlogLength: 0,
      disposables: [],
    };

    const dataListener = ptyProcess.onData((data) => {
      session.backlogChunks.push(data);
      session.backlogLength += data.length;
      const MAX_BACKLOG_SIZE = 100000;
      const TRIM_THRESHOLD = 120000;
      if (session.backlogLength > TRIM_THRESHOLD) {
        while (session.backlogChunks.length > 0 && session.backlogLength > MAX_BACKLOG_SIZE) {
          const removed = session.backlogChunks.shift()!;
          session.backlogLength -= removed.length;
        }
      }
      this.dataCallback?.(id, data);
    });

    const exitListener = ptyProcess.onExit(() => {
      this.killTerminal(id);
    });

    session.disposables.push(dataListener, exitListener);

    this.managedTerminals.set(id, session);

    if (!this.activeTerminalId) {
      this.activeTerminalId = id;
    }

    this.notifyChange();
    return id;
  }

  getTerminalIds(): string[] {
    return Array.from(this.managedTerminals.keys());
  }

  getTerminalName(id: string): string {
    return this.managedTerminals.get(id)?.name || "";
  }

  getActiveTerminalId(): string | null {
    return this.activeTerminalId;
  }

  setActiveTerminalId(id: string | null): void {
    if (id === null || this.managedTerminals.has(id)) {
      this.activeTerminalId = id;
      this.notifyChange();
    }
  }

  getBacklog(id: string): string {
    const session = this.managedTerminals.get(id);
    return session ? session.backlogChunks.join("") : "";
  }

  writeInput(id: string, data: string): void {
    const session = this.managedTerminals.get(id);
    if (session) {
      session.ptyProcess.write(data);
    }
  }

  resizeTerminal(id: string, cols: number, rows: number): void {
    const session = this.managedTerminals.get(id);
    if (session) {
      try {
        session.ptyProcess.resize(cols, rows);
      } catch (err) {
        console.error("Error resizing terminal:", err);
      }
    }
  }

  killTerminal(id: string): void {
    const session = this.managedTerminals.get(id);
    if (session) {
      session.disposables.forEach((d) => d.dispose());
      try {
        session.ptyProcess.kill();
      } catch (err) {
        // already dead
        console.warn("Error killing terminal:", err);
      }
      this.managedTerminals.delete(id);
      if (this.activeTerminalId === id) {
        const remaining = this.getTerminalIds();
        this.activeTerminalId = remaining.length > 0 ? remaining[0] : null;
      }
      this.notifyChange();
    }
  }

  dispose(): void {
    for (const [, session] of this.managedTerminals) {
      session.disposables.forEach((d) => d.dispose());
      try {
        session.ptyProcess.kill();
      } catch (err) {
        // already dead
        console.warn("Error killing terminal during dispose:", err);
      }
    }
    this.managedTerminals.clear();
    this.activeTerminalId = null;
  }

  private notifyChange(): void {
    this.changeCallback?.();
  }

  private getShellPath(): string {
    if (process.platform === "win32") {
      return process.env.COMSPEC || "powershell.exe";
    }

    const preferredShell = process.env.SHELL;
    if (preferredShell && preferredShell.startsWith("/") && fs.existsSync(preferredShell)) {
      return preferredShell;
    }

    const fallbacks = ["/bin/zsh", "/bin/bash", "/bin/sh"];
    for (const shell of fallbacks) {
      if (fs.existsSync(shell)) {
        return shell;
      }
    }

    return "/bin/sh";
  }

  private getWorkspaceFolder(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const folderPath = folders[0].uri.fsPath;
      if (fs.existsSync(folderPath)) {
        return folderPath;
      }
    }
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home && fs.existsSync(home)) {
      return home;
    }
    return process.cwd();
  }
}
