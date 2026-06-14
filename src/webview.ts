import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

interface TerminalInfo {
  id: string;
  name: string;
  isActive: boolean;
}

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const tabBar = document.getElementById('tabBar')!;
  const terminalContainer = document.getElementById('terminalContainer')!;
  const emptyState = document.getElementById('emptyState')!;
  const newTabBtn = document.getElementById('newTabBtn')!;

  const terminalInstances: Map<string, { term: Terminal; fitAddon: FitAddon; container: HTMLDivElement }> = new Map();
  let activeTerminalId: string | null = null;

  function createTerminalInstance(id: string) {
    const container = document.createElement('div');
    container.className = 'terminal-instance-container';
    container.id = `terminal-instance-${id}`;
    container.style.display = 'none';
    terminalContainer.appendChild(container);

    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 12,
      fontFamily: 'Consolas, Menlo, Monaco, "Courier New", monospace',
      theme: getVSCodeTheme(),
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(container);

    // Send input from terminal to extension host
    term.onData((data) => {
      vscode.postMessage({ type: 'input', terminalId: id, data });
    });

    // Handle resizing
    const resizeObserver = new ResizeObserver(() => {
      if (container.style.display !== 'none') {
        try {
          // Delay fitting slightly to let the DOM settle
          setTimeout(() => {
            try {
              fitAddon.fit();
              vscode.postMessage({
                type: 'resize',
                terminalId: id,
                cols: term.cols,
                rows: term.rows,
              });
            } catch (e) {}
          }, 50);
        } catch (e) {
          console.error('Resize error:', e);
        }
      }
    });
    resizeObserver.observe(container);

    terminalInstances.set(id, { term, fitAddon, container });

    // Request the backlog of data for this terminal
    vscode.postMessage({ type: 'requestBacklog', terminalId: id });
  }

  function getVSCodeTheme() {
    const style = getComputedStyle(document.body);
    const getVar = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;

    return {
      background: getVar('--vscode-terminal-background', getVar('--vscode-editor-background', '#1e1e1e')),
      foreground: getVar('--vscode-terminal-foreground', getVar('--vscode-editor-foreground', '#cccccc')),
      cursor: getVar('--vscode-terminalCursor-foreground', '#cccccc'),
      selectionBackground: getVar('--vscode-terminal-selectionBackground', '#3a3d41'),
      black: getVar('--vscode-terminal-ansiBlack', '#000000'),
      red: getVar('--vscode-terminal-ansiRed', '#cd3131'),
      green: getVar('--vscode-terminal-ansiGreen', '#0dbc79'),
      yellow: getVar('--vscode-terminal-ansiYellow', '#e5e510'),
      blue: getVar('--vscode-terminal-ansiBlue', '#2472c8'),
      magenta: getVar('--vscode-terminal-ansiMagenta', '#bc3fbc'),
      cyan: getVar('--vscode-terminal-ansiCyan', '#11a8cd'),
      white: getVar('--vscode-terminal-ansiWhite', '#e5e5e5'),
      brightBlack: getVar('--vscode-terminal-ansiBrightBlack', '#666666'),
      brightRed: getVar('--vscode-terminal-ansiBrightRed', '#f14c4c'),
      brightGreen: getVar('--vscode-terminal-ansiBrightGreen', '#23d18b'),
      brightYellow: getVar('--vscode-terminal-ansiBrightYellow', '#f5f543'),
      brightBlue: getVar('--vscode-terminal-ansiBrightBlue', '#3b8eea'),
      brightMagenta: getVar('--vscode-terminal-ansiBrightMagenta', '#d670d6'),
      brightCyan: getVar('--vscode-terminal-ansiBrightCyan', '#29b8db'),
      brightWhite: getVar('--vscode-terminal-ansiBrightWhite', '#e5e5e5'),
    };
  }

  function updateTheme() {
    const theme = getVSCodeTheme();
    for (const [, inst] of terminalInstances) {
      inst.term.options.theme = theme;
    }
  }

  // Monitor theme changes in VS Code
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        updateTheme();
      }
    });
  });
  observer.observe(document.body, { attributes: true });

  function renderTerminals(terminals: TerminalInfo[]) {
    // 1. Remove terminals that were killed
    const activeIds = new Set(terminals.map(t => t.id));
    for (const [id, inst] of terminalInstances) {
      if (!activeIds.has(id)) {
        inst.term.dispose();
        inst.container.remove();
        terminalInstances.delete(id);
      }
    }

    // 2. Add/Render new terminals
    terminals.forEach((t) => {
      if (!terminalInstances.has(t.id)) {
        createTerminalInstance(t.id);
      }
    });

    // 3. Update visibility and fit active terminal
    let activeId: string | null = null;
    terminals.forEach((t) => {
      const inst = terminalInstances.get(t.id);
      if (inst) {
        if (t.isActive) {
          inst.container.style.display = 'block';
          activeId = t.id;
          // Focus and fit active terminal
          setTimeout(() => {
            try {
              inst.fitAddon.fit();
              inst.term.focus();
              vscode.postMessage({
                type: 'resize',
                terminalId: t.id,
                cols: inst.term.cols,
                rows: inst.term.rows,
              });
            } catch (e) {}
          }, 50);
        } else {
          inst.container.style.display = 'none';
        }
      }
    });

    activeTerminalId = activeId;

    // 4. Update tab buttons
    tabBar.querySelectorAll('.tab').forEach((t) => t.remove());

    terminals.forEach((t) => {
      const tabEl = document.createElement('div');
      tabEl.className = 'tab' + (t.isActive ? ' active' : '');
      tabEl.dataset.id = t.id;

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = t.name;
      tabEl.appendChild(label);

      const closeBtn = document.createElement('span');
      closeBtn.className = 'close-btn';
      closeBtn.innerHTML = '&#x2715;';
      closeBtn.title = 'Close terminal';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: 'killTerminal', terminalId: t.id });
      });
      tabEl.appendChild(closeBtn);

      tabEl.addEventListener('click', () => {
        vscode.postMessage({ type: 'focusTerminal', terminalId: t.id });
      });

      tabBar.insertBefore(tabEl, newTabBtn);
    });

    // 5. Update empty state visibility
    if (terminals.length === 0) {
      emptyState.style.display = 'flex';
      terminalContainer.style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      terminalContainer.style.display = 'block';
    }
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'terminalList': {
        renderTerminals(msg.terminals);
        break;
      }
      case 'data': {
        const inst = terminalInstances.get(msg.terminalId);
        if (inst) {
          inst.term.write(msg.data);
        }
        break;
      }
      case 'backlog': {
        const inst = terminalInstances.get(msg.terminalId);
        if (inst) {
          inst.term.write(msg.data);
        }
        break;
      }
    }
  });

  // Focus terminal when clicking inside the container
  terminalContainer.addEventListener('click', () => {
    if (activeTerminalId) {
      const inst = terminalInstances.get(activeTerminalId);
      if (inst) {
        inst.term.focus();
      }
    }
  });

  // Signal that webview is ready to load terminals
  vscode.postMessage({ type: 'ready' });
})();
