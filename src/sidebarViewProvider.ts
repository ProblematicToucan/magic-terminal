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

  constructor(
    private readonly _extensionUri: vscode.Uri,
  ) {
    this._manager = new TerminalManager();

    this._manager.onOutput((terminalId, data) => {
      this._view?.webview.postMessage({
        type: 'output',
        terminalId,
        data,
      });
    });

    this._manager.onExit((terminalId, exitCode) => {
      this._view?.webview.postMessage({
        type: 'exit',
        terminalId,
        exitCode,
      });
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
        vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@xterm'),
        vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'xterm'),
      ],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      this._handleMessage(message);
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this._manager.getActiveTerminalId() === null) {
        this._manager.createTerminal();
      }
    });
  }

  createNewTerminal(): void {
    const id = this._manager.createTerminal();
    this._view?.webview.postMessage({ type: 'terminalCreated', terminalId: id });
    this._postTerminalList();
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
      case 'input': {
        if (message.terminalId && message.data != null) {
          this._manager.writeToTerminal(message.terminalId, message.data);
        }
        break;
      }
      case 'resize': {
        if (message.terminalId && message.cols && message.rows) {
          this._manager.resizeTerminal(message.terminalId, message.cols, message.rows);
        }
        break;
      }
      case 'createTerminal': {
        const id = this._manager.createTerminal();
        this._view?.webview.postMessage({ type: 'terminalCreated', terminalId: id });
        this._postTerminalList();
        break;
      }
      case 'focusTerminal': {
        if (message.terminalId) {
          this._manager.setActiveTerminal(message.terminalId);
          this._view?.webview.postMessage({ type: 'terminalFocused', terminalId: message.terminalId });
        }
        break;
      }
      case 'killTerminal': {
        if (message.terminalId) {
          this._manager.killTerminal(message.terminalId);
          this._view?.webview.postMessage({ type: 'terminalKilled', terminalId: message.terminalId });
          this._postTerminalList();
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
    this._view?.webview.postMessage({
      type: 'terminalList',
      terminals: ids.map((id) => ({ id, isActive: id === activeId })),
    });
  }

  private _getHtml(webview: vscode.Webview): string {
    const xtermUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.js'),
    );
    const xtermCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css'),
    );
    const fitAddonUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@xterm', 'addon-fit', 'lib', 'addon-fit.js'),
    );
    const webLinksUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@xterm', 'addon-web-links', 'lib', 'addon-web-links.js'),
    );

    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${xtermCssUri}">
  <style nonce="${nonce}">
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background-color: var(--vscode-panel-background, #1e1e1e);
      color: var(--vscode-panel-foreground, #cccccc);
    }

    .tab-bar {
      display: flex;
      align-items: center;
      background-color: var(--vscode-editor-background, #1e1e1e);
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #3c3c3c);
      min-height: 35px;
      flex-shrink: 0;
      overflow-x: auto;
    }

    .tab-bar::-webkit-scrollbar { height: 3px; }
    .tab-bar::-webkit-scrollbar-thumb {
      background-color: var(--vscode-scrollbarSlider-background, #424242);
    }

    .tab {
      display: flex;
      align-items: center;
      padding: 4px 12px;
      cursor: pointer;
      color: var(--vscode-tab-inactiveForeground, #999);
      background-color: var(--vscode-tab-inactiveBackground, #2d2d2d);
      border-right: 1px solid var(--vscode-sideBarSectionHeader-border, #3c3c3c);
      font-size: 12px;
      white-space: nowrap;
      user-select: none;
      height: 100%;
      gap: 8px;
    }

    .tab.active {
      color: var(--vscode-tab-activeForeground, #ffffff);
      background-color: var(--vscode-tab-activeBackground, #1e1e1e);
      border-bottom: 2px solid var(--vscode-tab-activeBorderTop, #007acc);
    }

    .tab:hover:not(.active) {
      background-color: var(--vscode-tab-hoverBackground, #353535);
    }

    .tab .label {
      max-width: 120px;
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
      font-size: 12px;
      line-height: 1;
      color: var(--vscode-tab-inactiveForeground, #999);
    }

    .tab .close-btn:hover {
      background-color: rgba(255, 255, 255, 0.12);
      color: var(--vscode-tab-activeForeground, #fff);
    }

    .new-tab-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      min-height: 35px;
      cursor: pointer;
      color: var(--vscode-tab-inactiveForeground, #999);
      font-size: 16px;
      flex-shrink: 0;
    }

    .new-tab-btn:hover {
      background-color: var(--vscode-tab-hoverBackground, #353535);
      color: var(--vscode-tab-activeForeground, #fff);
    }

    .terminal-container {
      flex: 1;
      padding: 4px;
      overflow: hidden;
    }

    .xterm-wrapper {
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <div class="tab-bar" id="tabBar">
    <div class="new-tab-btn" id="newTabBtn" title="New Terminal">+</div>
  </div>
  <div class="terminal-container">
    <div class="xterm-wrapper" id="terminal"></div>
  </div>

  <script nonce="${nonce}" src="${xtermUri}"></script>
  <script nonce="${nonce}" src="${fitAddonUri}"></script>
  <script nonce="${nonce}" src="${webLinksUri}"></script>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();

      let terminals = [];
      let activeTerminalId = null;
      let term = null;
      let fitAddon = null;
      let webLinksAddon = null;

      const tabBar = document.getElementById('tabBar');
      const terminalEl = document.getElementById('terminal');

      function initXterm() {
        if (term) { term.dispose(); }
        terminalEl.innerHTML = '';

        const bg = getComputedStyle(document.body).getPropertyValue('--vscode-panel-background').trim() || '#1e1e1e';
        const fg = getComputedStyle(document.body).getPropertyValue('--vscode-panel-foreground').trim() || '#cccccc';
        const cursor = getComputedStyle(document.body).getPropertyValue('--vscode-focusBorder').trim() || '#007acc';

        term = new Terminal({
          cursorBlink: true,
          cursorStyle: 'bar',
          fontSize: 13,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          theme: {
            background: bg,
            foreground: fg,
            cursor: cursor,
            selectionBackground: 'rgba(0, 122, 204, 0.3)',
          },
          allowProposedApi: true,
        });

        fitAddon = new FitAddon.FitAddon();
        webLinksAddon = new WebLinksAddon.WebLinksAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);

        term.open(terminalEl);

        term.onData(function (data) {
          if (activeTerminalId) {
            vscode.postMessage({ type: 'input', terminalId: activeTerminalId, data: data });
          }
        });

        term.onResize(function (size) {
          if (activeTerminalId) {
            vscode.postMessage({ type: 'resize', terminalId: activeTerminalId, cols: size.cols, rows: size.rows });
          }
        });

        setTimeout(function () {
          try { fitAddon.fit(); } catch (_) {}
        }, 50);
      }

      var resizeObserver = new ResizeObserver(function () {
        if (fitAddon) {
          try { fitAddon.fit(); } catch (_) {}
        }
      });
      resizeObserver.observe(terminalEl);

      function renderTabBar() {
        var existingTabs = tabBar.querySelectorAll('.tab');
        existingTabs.forEach(function (t) { t.remove(); });

        terminals.forEach(function (t) {
          var tabEl = document.createElement('div');
          tabEl.className = 'tab' + (t.isActive ? ' active' : '');
          tabEl.dataset.id = t.id;

          var label = document.createElement('span');
          label.className = 'label';
          label.textContent = t.id.replace('terminal-', 'Terminal ');
          tabEl.appendChild(label);

          var closeBtn = document.createElement('span');
          closeBtn.className = 'close-btn';
          closeBtn.textContent = '✕';
          closeBtn.title = 'Close terminal';
          closeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            vscode.postMessage({ type: 'killTerminal', terminalId: t.id });
          });
          tabEl.appendChild(closeBtn);

          tabEl.addEventListener('click', function () {
            if (t.id !== activeTerminalId) {
              vscode.postMessage({ type: 'focusTerminal', terminalId: t.id });
            }
          });

          tabBar.appendChild(tabEl);
        });
      }

      function setActiveTerminal(id) {
        activeTerminalId = id;
        if (term) { term.clear(); }
        renderTabBar();
      }

      window.addEventListener('message', function (event) {
        var msg = event.data;
        switch (msg.type) {
          case 'terminalCreated':
            terminals.push({ id: msg.terminalId, isActive: false });
            renderTabBar();
            if (!activeTerminalId) {
              vscode.postMessage({ type: 'focusTerminal', terminalId: msg.terminalId });
            }
            break;

          case 'terminalKilled':
            terminals = terminals.filter(function (t) { return t.id !== msg.terminalId; });
            if (activeTerminalId === msg.terminalId) {
              activeTerminalId = terminals.length > 0 ? terminals[0].id : null;
              if (activeTerminalId) {
                vscode.postMessage({ type: 'focusTerminal', terminalId: activeTerminalId });
              }
            }
            renderTabBar();
            break;

          case 'terminalFocused':
            setActiveTerminal(msg.terminalId);
            if (fitAddon) {
              setTimeout(function () { try { fitAddon.fit(); } catch (_) {} }, 30);
            }
            break;

          case 'terminalList':
            terminals = msg.terminals;
            renderTabBar();
            break;

          case 'output':
            if (msg.terminalId === activeTerminalId && term) {
              term.write(msg.data);
            }
            break;

          case 'exit':
            if (term && msg.terminalId === activeTerminalId) {
              term.write('\\r\\n[Process exited with code ' + msg.exitCode + ']\\r\\n');
            }
            break;
        }
      });

      document.getElementById('newTabBtn').addEventListener('click', function () {
        vscode.postMessage({ type: 'createTerminal' });
      });

      initXterm();
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
