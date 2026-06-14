import * as vscode from 'vscode';

export class TerminalManager {
  private managedTerminals: Map<string, vscode.Terminal> = new Map();
  private activeTerminalId: string | null = null;
  private nextId = 1;
  private disposables: vscode.Disposable[] = [];

  private changeCallback: (() => void) | null = null;

  constructor() {
    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        for (const [id, t] of this.managedTerminals) {
          if (t === terminal) {
            this.managedTerminals.delete(id);
            if (this.activeTerminalId === id) {
              this.activeTerminalId = null;
            }
            this.notifyChange();
            return;
          }
        }
      }),
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        if (!terminal) { return; }
        for (const [id, t] of this.managedTerminals) {
          if (t === terminal) {
            this.activeTerminalId = id;
            this.notifyChange();
            return;
          }
        }
      }),
    );
  }

  onChange(cb: () => void): void {
    this.changeCallback = cb;
  }

  createTerminal(name?: string): string {
    const id = `terminal-${this.nextId++}`;
    const displayName = name || `Terminal ${this.nextId - 1}`;

    const terminal = vscode.window.createTerminal({
      name: displayName,
      location: vscode.TerminalLocation.Panel,
    });

    this.managedTerminals.set(id, terminal);
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

  focusTerminal(id: string): void {
    const terminal = this.managedTerminals.get(id);
    if (terminal) {
      this.activeTerminalId = id;
      terminal.show();
      this.notifyChange();
    }
  }

  killTerminal(id: string): void {
    const terminal = this.managedTerminals.get(id);
    if (terminal) {
      terminal.dispose();
      this.managedTerminals.delete(id);
      if (this.activeTerminalId === id) {
        this.activeTerminalId = null;
      }
      this.notifyChange();
    }
  }

  dispose(): void {
    for (const [, terminal] of this.managedTerminals) {
      terminal.dispose();
    }
    this.managedTerminals.clear();
    this.activeTerminalId = null;
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private notifyChange(): void {
    this.changeCallback?.();
  }
}
