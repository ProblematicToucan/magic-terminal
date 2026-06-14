import * as vscode from 'vscode';
import * as pty from 'node-pty';
import * as fs from 'fs';
import * as path from 'path';

interface TerminalSession {
  id: string;
  name: string;
  ptyProcess: pty.IPty;
  backlog: string;
}

export class TerminalManager {
  private managedTerminals: Map<string, TerminalSession> = new Map();
  private activeTerminalId: string | null = null;
  private nextId = 1;
  private changeCallback: (() => void) | null = null;
  private dataCallback: ((terminalId: string, data: string) => void) | null = null;

  onChange(cb: () => void): void {
    this.changeCallback = cb;
  }

  onData(cb: (terminalId: string, data: string) => void): void {
    this.dataCallback = cb;
  }

  createTerminal(name?: string): string {
    const id = `terminal-${this.nextId++}`;
    const displayName = name || `Terminal ${this.nextId - 1}`;

    const shell = this.getShellPath();
    const cwd = path.resolve(this.getWorkspaceFolder());
    
    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    } as Record<string, string>;

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env,
    });

    const session: TerminalSession = {
      id,
      name: displayName,
      ptyProcess,
      backlog: '',
    };

    ptyProcess.onData((data) => {
      session.backlog += data;
      const MAX_BACKLOG_SIZE = 100000;
      if (session.backlog.length > MAX_BACKLOG_SIZE) {
        session.backlog = session.backlog.slice(session.backlog.length - MAX_BACKLOG_SIZE);
      }
      this.dataCallback?.(id, data);
    });

    ptyProcess.onExit(() => {
      this.killTerminal(id);
    });

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
    return this.managedTerminals.get(id)?.name || '';
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
    return this.managedTerminals.get(id)?.backlog || '';
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
        console.error('Error resizing terminal:', err);
      }
    }
  }

  killTerminal(id: string): void {
    const session = this.managedTerminals.get(id);
    if (session) {
      try {
        session.ptyProcess.kill();
      } catch (err) {
        // already dead
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
      try {
        session.ptyProcess.kill();
      } catch (err) {}
    }
    this.managedTerminals.clear();
    this.activeTerminalId = null;
  }

  private notifyChange(): void {
    this.changeCallback?.();
  }

  private getShellPath(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'powershell.exe';
    }
    
    const preferredShell = process.env.SHELL;
    if (preferredShell && preferredShell.startsWith('/') && fs.existsSync(preferredShell)) {
      return preferredShell;
    }
    
    const fallbacks = ['/bin/zsh', '/bin/bash', '/bin/sh'];
    for (const shell of fallbacks) {
      if (fs.existsSync(shell)) {
        return shell;
      }
    }
    
    return '/bin/sh';
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
