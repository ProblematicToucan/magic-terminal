import * as vscode from 'vscode';
import { TerminalManager } from './terminalManager';
import { IpcServer, type ActiveFileInfo } from './ipcServer';

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
  private _viewDisposables: vscode.Disposable[] = [];
  private _ipcServer: IpcServer;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._manager = new TerminalManager();
    this._manager.onChange(() => this._postTerminalList());
    this._manager.onData((id, data) => {
      this._view?.webview.postMessage({ type: 'data', terminalId: id, data });
    });

    this._ipcServer = new IpcServer();
    this._ipcServer.start().then((port) => {
      this._manager.setIpcPort(port);
    });

    this._updateActiveFile();
    vscode.window.onDidChangeActiveTextEditor(() => this._updateActiveFile());
    vscode.workspace.onDidChangeWorkspaceFolders(() => this._updateActiveFile());
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._cleanViewDisposables();
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this._extensionUri
      ]
    };

    const loaderUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'vendor', 'xterm-loader.js')
    );
    const coreUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'vendor', 'xterm-core.gz')
    );
    const webviewUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js')
    );
    const cssUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'xterm.css')
    );

    webviewView.webview.html = this._getHtml(loaderUri, coreUri, webviewUri, cssUri);

    this._viewDisposables.push(
      webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
        this._handleMessage(message);
      })
    );

    this._viewDisposables.push(
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          if (this._manager.getTerminalIds().length === 0) {
            this._manager.createTerminal();
          }
          this._postTerminalList();
        }
      })
    );

    this._viewDisposables.push(
      webviewView.onDidDispose(() => {
        this._cleanViewDisposables();
      })
    );

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
    this._cleanViewDisposables();
    this._manager.dispose();
    this._ipcServer.stop();
  }

  private _cleanViewDisposables(): void {
    this._viewDisposables.forEach((d) => d.dispose());
    this._viewDisposables = [];
    this._view = null;
  }

  private _updateActiveFile(): void {
    const editor = vscode.window.activeTextEditor;
    const doc = editor?.document;

    const workspaceFolder = doc
      ? vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ?? null
      : null;

    let selection: ActiveFileInfo["selection"] = null;
    if (editor && !editor.selection.isEmpty) {
      const sel = editor.selection;
      const text = doc?.getText(sel) ?? "";
      selection = {
        text,
        startLine: sel.start.line,
        startCharacter: sel.start.character,
        endLine: sel.end.line,
        endCharacter: sel.end.character,
      };
    }

    this._ipcServer.update({
      path: doc?.uri.fsPath ?? null,
      workspaceFolder,
      selection,
    });
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

  private _getHtml(loaderUri: vscode.Uri, coreUri: vscode.Uri, webviewUri: vscode.Uri, cssUri: vscode.Uri): string {
    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${this._view?.webview.cspSource}; script-src 'nonce-${nonce}' 'strict-dynamic' blob:; connect-src ${this._view?.webview.cspSource}; font-src ${this._view?.webview.cspSource};">
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
      padding: 0 12px;
      height: 40px;
      flex-shrink: 0;
      position: relative;
    }

    .header-bar .title {
      font-weight: 600;
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.5px;
      color: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground));
      opacity: 0.8;
      user-select: none;
    }

    .actions {
      display: flex;
      align-items: center;
    }

    .action-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border: none;
      background: transparent;
      color: var(--vscode-icon-foreground, var(--vscode-foreground));
      cursor: pointer;
      border-radius: 4px;
      outline: none;
      flex-shrink: 0;
    }

    .action-btn:hover {
      background-color: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
    }

    .action-btn:active {
      background-color: var(--vscode-toolbar-activeBackground, rgba(90, 93, 94, 0.5));
    }

    .action-btn svg {
      width: 18px;
      height: 18px;
      display: block;
      flex-shrink: 0;
    }

    /* Popup Menu */
    .menu-popup {
      position: absolute;
      top: 36px;
      right: 8px;
      background-color: var(--vscode-menu-background, var(--vscode-dropdown-background, #252526));
      color: var(--vscode-menu-foreground, var(--vscode-dropdown-foreground, #cccccc));
      border: 1px solid var(--vscode-menu-border, var(--vscode-dropdown-border, #454545));
      border-radius: 4px;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25);
      z-index: 1000;
      min-width: 180px;
      display: none;
      flex-direction: column;
      padding: 4px 0;
      user-select: none;
    }

    .menu-item {
      display: flex;
      align-items: center;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 11px;
      gap: 8px;
      position: relative;
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
    }

    .menu-item:hover {
      background-color: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground, #007acc));
      color: var(--vscode-menu-selectionForeground, var(--vscode-list-hoverForeground, #ffffff)) !important;
    }

    .menu-item.active {
      font-weight: 500;
    }

    .menu-item .active-indicator {
      width: 12px;
      height: 12px;
      flex-shrink: 0;
      visibility: hidden;
    }

    .menu-item.active .active-indicator {
      visibility: visible;
    }

    .menu-item .item-label {
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .menu-item .item-close-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border: none;
      background: transparent;
      color: inherit;
      opacity: 0.6;
      cursor: pointer;
      border-radius: 3px;
      visibility: hidden;
    }

    .menu-item:hover .item-close-btn {
      visibility: visible;
    }

    .menu-item .item-close-btn:hover {
      background-color: rgba(255, 255, 255, 0.15);
      opacity: 1;
    }

    .menu-item .item-close-btn svg {
      width: 10px;
      height: 10px;
    }

    .menu-separator {
      height: 1px;
      background-color: var(--vscode-menu-separatorBackground, var(--vscode-sideBarSectionHeader-border, #454545));
      margin: 4px 0;
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
      padding: 4px 4px 4px 12px;
    }
  </style>
</head>
<body>
  <div class="header-bar" id="headerBar">
    <div class="title">Terminal</div>
    <div class="actions">
      <button class="action-btn" id="stackBtn" title="Manage Terminals">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M1 2h14v12H1V2zm1 1v10h12V3H2zm2.5 2.5L7 7l-2.5 1.5-.5-.7 1.3-.8L4 6.2l.5-.7zM8 8h3v1H8V8z"/>
        </svg>
      </button>
    </div>
    <div class="menu-popup" id="menuPopup">
      <div class="menu-item" id="menuNewTerminal">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M8 2.5a.5.5 0 0 1 .5.5v4.5H13a.5.5 0 0 1 0 1H8.5V13a.5.5 0 0 1-1 0V8.5H3a.5.5 0 0 1 0-1h4.5V3a.5.5 0 0 1 .5-.5z"/>
        </svg>
        <span class="item-label">New Terminal</span>
      </div>
      <div class="menu-separator"></div>
      <div id="menuTerminalList"></div>
    </div>
  </div>
  <div id="emptyState" class="empty-state" style="display: none;">
    <div>No terminals open</div>
    <div class="hint">Click <kbd>+</kbd> to create one</div>
  </div>
  <div id="terminalContainer"></div>

  <script nonce="${nonce}">window.__xtermCore='${coreUri}';window.__webview='${webviewUri}'</script>
  <script nonce="${nonce}" src="${loaderUri}"></script>
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
