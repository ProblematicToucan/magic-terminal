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

  const terminalSelect = document.getElementById('terminalSelect') as HTMLSelectElement;
  const newTerminalBtn = document.getElementById('newTerminalBtn')!;
  const killTerminalBtn = document.getElementById('killTerminalBtn') as HTMLButtonElement;
  const terminalContainer = document.getElementById('terminalContainer')!;
  const emptyState = document.getElementById('emptyState')!;

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

    // 4. Update dropdown options
    terminalSelect.innerHTML = '';

    if (terminals.length === 0) {
      const option = document.createElement('option');
      option.text = 'No Terminals';
      option.value = '';
      terminalSelect.appendChild(option);
      terminalSelect.disabled = true;
      killTerminalBtn.disabled = true;
    } else {
      terminalSelect.disabled = false;
      killTerminalBtn.disabled = false;
      terminals.forEach((t) => {
        const option = document.createElement('option');
        option.value = t.id;
        option.text = t.name;
        option.selected = t.isActive;
        terminalSelect.appendChild(option);
      });
    }

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

  // Dropdown selection change
  terminalSelect.addEventListener('change', () => {
    const selectedId = terminalSelect.value;
    if (selectedId) {
      vscode.postMessage({ type: 'focusTerminal', terminalId: selectedId });
    }
  });

  // Create terminal click
  newTerminalBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'createTerminal' });
  });

  // Kill terminal click
  killTerminalBtn.addEventListener('click', () => {
    if (activeTerminalId) {
      vscode.postMessage({ type: 'killTerminal', terminalId: activeTerminalId });
    }
  });

  // Signal that webview is ready to load terminals
  vscode.postMessage({ type: 'ready' });
})();
