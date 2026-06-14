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

    .tab-bar {
      display: flex;
      align-items: stretch;
      background-color: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
      min-height: 32px;
      flex-shrink: 0;
      overflow-x: auto;
    }

    .tab-bar::-webkit-scrollbar { height: 3px; }
    .tab-bar::-webkit-scrollbar-thumb {
      background-color: var(--vscode-scrollbarSlider-background);
      border-radius: 2px;
    }

    .tab {
      display: flex;
      align-items: center;
      padding: 0 10px;
      cursor: pointer;
      color: var(--vscode-tab-inactiveForeground);
      background-color: var(--vscode-tab-inactiveBackground);
      border-right: 1px solid var(--vscode-sideBarSectionHeader-border);
      font-size: 12px;
      white-space: nowrap;
      user-select: none;
      gap: 6px;
      height: 32px;
      flex-shrink: 0;
    }

    .tab.active {
      color: var(--vscode-tab-activeForeground);
      background-color: var(--vscode-tab-activeBackground);
      border-bottom: 2px solid var(--vscode-tab-activeBorderTop);
    }

    .tab:hover:not(.active) {
      background-color: var(--vscode-tab-hoverBackground);
    }

    .tab .label {
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .tab .close-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 3px;
      font-size: 11px;
      line-height: 1;
      flex-shrink: 0;
      opacity: 0.7;
    }

    .tab:hover .close-btn { opacity: 1; }
    .tab .close-btn:hover {
      background-color: rgba(255, 255, 255, 0.15);
    }

    .new-tab-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 32px;
      height: 32px;
      cursor: pointer;
      color: var(--vscode-tab-inactiveForeground);
      font-size: 16px;
      flex-shrink: 0;
      border-right: 1px solid var(--vscode-sideBarSectionHeader-border);
    }

    .new-tab-btn:hover {
      background-color: var(--vscode-tab-hoverBackground);
      color: var(--vscode-tab-activeForeground);
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
  <div class="tab-bar" id="tabBar">
    <div class="new-tab-btn" id="newTabBtn" title="New Terminal">+</div>
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
