import * as vscode from 'vscode';
import { TerminalManager } from './terminalManager';

interface WebviewMessage {
  type: string;
  terminalId?: string;
}

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | null = null;
  private _manager: TerminalManager;

  constructor() {
    this._manager = new TerminalManager();
    this._manager.onChange(() => this._postTerminalList());
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this._getHtml();

    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      this._handleMessage(message);
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this._manager.getTerminalIds().length === 0) {
        this._manager.createTerminal();
      }
      this._postTerminalList();
    });
  }

  createNewTerminal(): void {
    const id = this._manager.createTerminal();
    this._manager.focusTerminal(id);
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
      case 'createTerminal': {
        const id = this._manager.createTerminal();
        this._manager.focusTerminal(id);
        break;
      }
      case 'focusTerminal': {
        if (message.terminalId) {
          this._manager.focusTerminal(message.terminalId);
        }
        break;
      }
      case 'killTerminal': {
        if (message.terminalId) {
          this._manager.killTerminal(message.terminalId);
        }
        break;
      }
      case 'requestTerminalList': {
        this._postTerminalList();
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

  private _getHtml(): string {
    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background-color: var(--vscode-sideBar-background);
      color: var(--vscode-sideBar-foreground);
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
  </style>
</head>
<body>
  <div class="tab-bar" id="tabBar">
    <div class="new-tab-btn" id="newTabBtn" title="New Terminal">+</div>
  </div>
  <div id="emptyState" class="empty-state">
    <div>No terminals open</div>
    <div class="hint">Click <kbd>+</kbd> to create one</div>
  </div>

  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();

      const tabBar = document.getElementById('tabBar');
      const emptyState = document.getElementById('emptyState');

      function renderTabBar(terminals) {
        tabBar.querySelectorAll('.tab').forEach(function (t) { t.remove(); });

        if (!terminals || terminals.length === 0) {
          emptyState.style.display = 'flex';
        } else {
          emptyState.style.display = 'none';
        }

        terminals.forEach(function (t) {
          var tabEl = document.createElement('div');
          tabEl.className = 'tab' + (t.isActive ? ' active' : '');
          tabEl.dataset.id = t.id;

          var label = document.createElement('span');
          label.className = 'label';
          label.textContent = t.name;
          tabEl.appendChild(label);

          var closeBtn = document.createElement('span');
          closeBtn.className = 'close-btn';
          closeBtn.innerHTML = '&#x2715;';
          closeBtn.title = 'Close terminal';
          closeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            vscode.postMessage({ type: 'killTerminal', terminalId: t.id });
          });
          tabEl.appendChild(closeBtn);

          tabEl.addEventListener('click', function () {
            vscode.postMessage({ type: 'focusTerminal', terminalId: t.id });
          });

          tabBar.appendChild(tabEl);
        });
      }

      window.addEventListener('message', function (event) {
        var msg = event.data;
        if (msg.type === 'terminalList') {
          renderTabBar(msg.terminals);
        }
      });

      document.getElementById('newTabBtn').addEventListener('click', function () {
        vscode.postMessage({ type: 'createTerminal' });
      });

      vscode.postMessage({ type: 'requestTerminalList' });
      vscode.postMessage({ type: 'createTerminal' });
    })();
  </script>
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
