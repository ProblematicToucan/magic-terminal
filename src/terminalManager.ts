import * as pty from 'node-pty';
import * as os from 'os';
import * as vscode from 'vscode';

export interface TerminalInfo {
  id: string;
  ptyProcess: pty.IPty;
  outputBuffer: string[];
  title: string;
}

export class TerminalManager {
  private terminals: Map<string, TerminalInfo> = new Map();
  private activeTerminalId: string | null = null;
  private nextId = 1;

  private outputCallback: ((terminalId: string, data: string) => void) | null = null;
  private exitCallback: ((terminalId: string, exitCode: number) => void) | null = null;
  private titleCallback: ((terminalId: string, title: string) => void) | null = null;

  onOutput(cb: (terminalId: string, data: string) => void): void {
    this.outputCallback = cb;
  }

  onExit(cb: (terminalId: string, exitCode: number) => void): void {
    this.exitCallback = cb;
  }

  onTitleChange(cb: (terminalId: string, title: string) => void): void {
    this.titleCallback = cb;
  }

  createTerminal(): string {
    const config = vscode.workspace.getConfiguration('magic-terminal');
    const shell = config.get<string>('shell') || process.env.SHELL || this.platformDefaultShell();
    const shellArgs = config.get<string[]>('shellArgs') || [];
    let cwd = config.get<string>('cwd') || '';
    if (!cwd) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      cwd = workspaceFolders?.[0]?.uri.fsPath || os.homedir();
    }

    const id = `terminal-${this.nextId++}`;

    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as { [key: string]: string },
    });

    const info: TerminalInfo = {
      id,
      ptyProcess,
      outputBuffer: [],
      title: `Terminal ${this.nextId - 1}`,
    };

    ptyProcess.onData((data: string) => {
      if (id === this.activeTerminalId) {
        this.outputCallback?.(id, data);
      } else {
        info.outputBuffer.push(data);
        if (info.outputBuffer.length > 500) {
          info.outputBuffer.shift();
        }
      }
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.exitCallback?.(id, exitCode);
      this.terminals.delete(id);
      if (this.activeTerminalId === id) {
        this.activeTerminalId = null;
      }
    });

    this.terminals.set(id, info);

    if (!this.activeTerminalId) {
      this.activeTerminalId = id;
    }

    return id;
  }

  getTerminalIds(): string[] {
    return Array.from(this.terminals.keys());
  }

  getTerminalInfo(id: string): TerminalInfo | undefined {
    return this.terminals.get(id);
  }

  getActiveTerminalId(): string | null {
    return this.activeTerminalId;
  }

  setActiveTerminal(id: string): void {
    this.activeTerminalId = id;
    const info = this.terminals.get(id);
    if (info) {
      for (const data of info.outputBuffer) {
        this.outputCallback?.(id, data);
      }
      info.outputBuffer = [];
    }
  }

  writeToTerminal(id: string, data: string): void {
    const info = this.terminals.get(id);
    if (info) {
      info.ptyProcess.write(data);
    }
  }

  resizeTerminal(id: string, cols: number, rows: number): void {
    const info = this.terminals.get(id);
    if (info) {
      info.ptyProcess.resize(cols, rows);
    }
  }

  killTerminal(id: string): void {
    const info = this.terminals.get(id);
    if (info) {
      info.ptyProcess.kill();
    }
  }

  dispose(): void {
    for (const [, info] of this.terminals) {
      info.ptyProcess.kill();
    }
    this.terminals.clear();
    this.activeTerminalId = null;
  }

  private platformDefaultShell(): string {
    if (os.platform() === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return '/bin/bash';
  }
}
