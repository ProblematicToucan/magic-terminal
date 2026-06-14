import * as vscode from 'vscode';
import { TerminalManager } from './terminalManager';

interface WebviewMessage {
  type: string;
  terminalId?: string;
  data?: string;
  cols?: number;
  rows?: number;
}

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | null = null;
  private _manager: TerminalManager;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._manager = new TerminalManager();
    this._manager.onChange(() => this._postTerminalList());
    this._manager.onData((id, data) => {
      this._view?.webview.postMessage({ type: 'data', terminalId: id, data });
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this._extensionUri
      ]
    };

    const webviewUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js')
    );
    const cssUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'xterm.css')
    );

    webviewView.webview.html = this._getHtml(webviewUri, cssUri);

    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      this._handleMessage(message);
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        if (this._manager.getTerminalIds().length === 0) {
          this._manager.createTerminal();
        }
        this._postTerminalList();
      }
    });

    if (this._manager.getTerminalIds().length === 0) {
      this._manager.createTerminal();
    }
    this._postTerminalList();
  }

  createNewTerminal(): void {
    const id = this._manager.createTerminal();
    this._manager.setActiveTerminalId(id);
  }

  killActiveTerminal(): void {
    const activeId = this._manager.getActiveTerminalId();
    if (activeId) {
      this._manager.killTerminal(activeId);
    }
  }

  dispose(): void {
    this._manager.dispose();
  }

  private _handleMessage(message: WebviewMessage): void {
    switch (message.type) {
      case 'ready': {
        this._postTerminalList();
        break;
      }
      case 'createTerminal': {
        const id = this._manager.createTerminal();
        this._manager.setActiveTerminalId(id);
        break;
      }
      case 'focusTerminal': {
        if (message.terminalId) {
          this._manager.setActiveTerminalId(message.terminalId);
        }
        break;
      }
      case 'killTerminal': {
        if (message.terminalId) {
          this._manager.killTerminal(message.terminalId);
        }
        break;
      }
      case 'input': {
        if (message.terminalId && typeof message.data === 'string') {
          this._manager.writeInput(message.terminalId, message.data);
        }
        break;
      }
      case 'resize': {
        if (message.terminalId && typeof message.cols === 'number' && typeof message.rows === 'number') {
          this._manager.resizeTerminal(message.terminalId, message.cols, message.rows);
        }
        break;
      }
      case 'requestBacklog': {
        if (message.terminalId) {
          const backlog = this._manager.getBacklog(message.terminalId);
          this._view?.webview.postMessage({
            type: 'backlog',
            terminalId: message.terminalId,
            data: backlog
          });
        }
        break;
      }
    }
  }

  private _postTerminalList(): void {
    const ids = this._manager.getTerminalIds();
    const activeId = this._manager.getActiveTerminalId();
    const terminals = ids.map((id) => ({
      id,
      name: this._manager.getTerminalName(id),
      isActive: id === activeId,
    }));
    this._view?.webview.postMessage({ type: 'terminalList', terminals });
  }

  private _getHtml(webviewUri: vscode.Uri, cssUri: vscode.Uri): string {
    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${this._view?.webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${this._view?.webview.cspSource};">
  <link rel="stylesheet" href="${cssUri}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background-color: var(--vscode-terminal-background, var(--vscode-sideBar-background));
      color: var(--vscode-terminal-foreground, var(--vscode-sideBar-foreground));
      font-family: var(--vscode-font-family);
      font-size: 12px;
    }

    .header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background-color: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
      padding: 4px 8px;
      min-height: 36px;
      flex-shrink: 0;
      gap: 8px;
    }

    .select-container {
      flex: 1;
      min-width: 0;
      position: relative;
    }

    .select-container::after {
      content: '';
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-top: 4px solid var(--vscode-dropdown-foreground, var(--vscode-settings-selectForeground, #cccccc));
      pointer-events: none;
    }

    .terminal-select {
      width: 100%;
      height: 24px;
      background-color: var(--vscode-dropdown-background, var(--vscode-settings-selectBackground, #3c3c3c));
      color: var(--vscode-dropdown-foreground, var(--vscode-settings-selectForeground, #cccccc));
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-settings-selectBorder, #3c3c3c));
      border-radius: 4px;
      padding: 0 8px;
      padding-right: 24px;
      font-family: var(--vscode-font-family);
      font-size: 11px;
      outline: none;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;
    }

    .terminal-select:focus {
      border-color: var(--vscode-focusBorder);
    }

    .terminal-select:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .action-buttons {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .action-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      color: var(--vscode-icon-foreground, var(--vscode-foreground));
      cursor: pointer;
      border-radius: 4px;
      outline: none;
    }

    .action-btn:hover {
      background-color: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
    }

    .action-btn:active {
      background-color: var(--vscode-toolbar-activeBackground, rgba(90, 93, 94, 0.5));
    }

    .action-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      pointer-events: none;
    }

    .action-btn svg {
      width: 16px;
      height: 16px;
    }

    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .empty-state .hint {
      font-size: 11px;
      opacity: 0.7;
    }

    .empty-state kbd {
      display: inline-block;
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 3px;
      padding: 0 4px;
      font-size: 10px;
      font-family: var(--vscode-font-family);
    }

    #terminalContainer {
      flex: 1;
      min-height: 0;
      position: relative;
      background-color: var(--vscode-terminal-background);
    }

    .terminal-instance-container {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 4px;
    }
  </style>
</head>
<body>
  <div class="header-bar" id="headerBar">
    <div class="select-container">
      <select id="terminalSelect" class="terminal-select"></select>
    </div>
    <div class="action-buttons">
      <button class="action-btn" id="newTerminalBtn" title="New Terminal">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M8 2.5a.5.5 0 0 1 .5.5v4.5H13a.5.5 0 0 1 0 1H8.5V13a.5.5 0 0 1-1 0V8.5H3a.5.5 0 0 1 0-1h4.5V3a.5.5 0 0 1 .5-.5z"/>
        </svg>
      </button>
      <button class="action-btn" id="killTerminalBtn" title="Kill Active Terminal">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M10 3h3v1h-1v9l-1 1H5l-1-1V4H3V3h3V2h4v1zM5 13h6V4H5v9zm2-7H6v5h1V6zm3 0H9v5h1V6z"/>
        </svg>
      </button>
    </div>
  </div>
  <div id="emptyState" class="empty-state" style="display: none;">
    <div>No terminals open</div>
    <div class="hint">Click <kbd>+</kbd> to create one</div>
  </div>
  <div id="terminalContainer"></div>

  <script nonce="${nonce}" src="${webviewUri}"></script>
</body>
</html>`;
  }

  private _getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
