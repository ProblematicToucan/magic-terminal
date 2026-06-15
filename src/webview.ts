import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

interface TerminalInfo {
  id: string;
  name: string;
  isActive: boolean;
}

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const stackBtn = document.getElementById("stackBtn")!;
  const menuPopup = document.getElementById("menuPopup")!;
  const menuNewTerminal = document.getElementById("menuNewTerminal")!;
  const menuTerminalList = document.getElementById("menuTerminalList")!;
  const terminalContainer = document.getElementById("terminalContainer")!;
  const emptyState = document.getElementById("emptyState")!;

  const terminalInstances: Map<
    string,
    {
      term: Terminal;
      fitAddon: FitAddon;
      container: HTMLDivElement;
      resizeObserver: ResizeObserver;
      fitTimeout: ReturnType<typeof setTimeout> | null;
      pendingData: string[];
      backlogReceived: boolean;
    }
  > = new Map();
  let activeTerminalId: string | null = null;

  function createTerminalInstance(id: string) {
    const container = document.createElement("div");
    container.className = "terminal-instance-container";
    container.id = `terminal-instance-${id}`;
    container.style.display = "none";
    terminalContainer.appendChild(container);

    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      cursorStyle: "block",
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
      vscode.postMessage({ type: "input", terminalId: id, data });
    });

    // Handle resizing
    const resizeObserver = new ResizeObserver(() => {
      if (container.style.display !== "none") {
        try {
          const inst = terminalInstances.get(id);
          if (inst) {
            if (inst.fitTimeout !== null) {
              clearTimeout(inst.fitTimeout);
            }
            inst.fitTimeout = setTimeout(() => {
              inst.fitTimeout = null;
              try {
                fitAddon.fit();
                vscode.postMessage({
                  type: "resize",
                  terminalId: id,
                  cols: term.cols,
                  rows: term.rows,
                });
              } catch (e) {
                console.error("Fit error:", e);
              }
            }, 50);
          }
        } catch (e) {
          console.error("Resize error:", e);
        }
      }
    });
    resizeObserver.observe(container);

    terminalInstances.set(id, {
      term,
      fitAddon,
      container,
      resizeObserver,
      fitTimeout: null,
      pendingData: [],
      backlogReceived: false,
    });

    // Request the backlog of data for this terminal
    vscode.postMessage({ type: "requestBacklog", terminalId: id });
  }

  function getVSCodeTheme() {
    const style = getComputedStyle(document.body);
    const getVar = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;

    return {
      background: getVar(
        "--vscode-terminal-background",
        getVar("--vscode-editor-background", "#1e1e1e"),
      ),
      foreground: getVar(
        "--vscode-terminal-foreground",
        getVar("--vscode-editor-foreground", "#cccccc"),
      ),
      cursor: getVar("--vscode-terminalCursor-foreground", "#cccccc"),
      selectionBackground: getVar("--vscode-terminal-selectionBackground", "#3a3d41"),
      black: getVar("--vscode-terminal-ansiBlack", "#000000"),
      red: getVar("--vscode-terminal-ansiRed", "#cd3131"),
      green: getVar("--vscode-terminal-ansiGreen", "#0dbc79"),
      yellow: getVar("--vscode-terminal-ansiYellow", "#e5e510"),
      blue: getVar("--vscode-terminal-ansiBlue", "#2472c8"),
      magenta: getVar("--vscode-terminal-ansiMagenta", "#bc3fbc"),
      cyan: getVar("--vscode-terminal-ansiCyan", "#11a8cd"),
      white: getVar("--vscode-terminal-ansiWhite", "#e5e5e5"),
      brightBlack: getVar("--vscode-terminal-ansiBrightBlack", "#666666"),
      brightRed: getVar("--vscode-terminal-ansiBrightRed", "#f14c4c"),
      brightGreen: getVar("--vscode-terminal-ansiBrightGreen", "#23d18b"),
      brightYellow: getVar("--vscode-terminal-ansiBrightYellow", "#f5f543"),
      brightBlue: getVar("--vscode-terminal-ansiBrightBlue", "#3b8eea"),
      brightMagenta: getVar("--vscode-terminal-ansiBrightMagenta", "#d670d6"),
      brightCyan: getVar("--vscode-terminal-ansiBrightCyan", "#29b8db"),
      brightWhite: getVar("--vscode-terminal-ansiBrightWhite", "#e5e5e5"),
    };
  }

  function updateTheme() {
    const theme = getVSCodeTheme();
    for (const [, inst] of terminalInstances) {
      inst.term.options.theme = theme;
    }
  }

  // Monitor theme changes in VS Code
  const observer = new MutationObserver(() => {
    updateTheme();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  function renderTerminals(terminals: TerminalInfo[]) {
    // 1. Remove terminals that were killed
    const activeIds = new Set(terminals.map((t) => t.id));
    for (const [id, inst] of terminalInstances) {
      if (!activeIds.has(id)) {
        if (inst.fitTimeout !== null) {
          clearTimeout(inst.fitTimeout);
        }
        inst.resizeObserver.disconnect();
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
          const wasActive = activeTerminalId === t.id;
          inst.container.style.display = "block";
          activeId = t.id;

          if (!wasActive) {
            if (inst.fitTimeout !== null) {
              clearTimeout(inst.fitTimeout);
            }
            inst.fitTimeout = setTimeout(() => {
              inst.fitTimeout = null;
              try {
                inst.fitAddon.fit();
                inst.term.focus();
                vscode.postMessage({
                  type: "resize",
                  terminalId: t.id,
                  cols: inst.term.cols,
                  rows: inst.term.rows,
                });
              } catch (e) {
                console.error("Fit error:", e);
              }
            }, 50);
          }
        } else {
          inst.container.style.display = "none";
        }
      }
    });

    activeTerminalId = activeId;

    // 4. Update menu terminal list
    menuTerminalList.innerHTML = "";

    terminals.forEach((t) => {
      const itemEl = document.createElement("div");
      itemEl.className = "menu-item" + (t.isActive ? " active" : "");
      itemEl.dataset.id = t.id;

      // Create checkmark icon
      const checkSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      checkSvg.setAttribute("class", "active-indicator");
      checkSvg.setAttribute("width", "12");
      checkSvg.setAttribute("height", "12");
      checkSvg.setAttribute("viewBox", "0 0 16 16");
      checkSvg.setAttribute("fill", "currentColor");
      checkSvg.innerHTML =
        '<path fill-rule="evenodd" clip-rule="evenodd" d="M13.849 3.147L5.01 11.986 2.152 9.127 1.445 9.834 5.01 13.4 14.556 3.854z"/>';
      itemEl.appendChild(checkSvg);

      // Create label
      const labelSpan = document.createElement("span");
      labelSpan.className = "item-label";
      labelSpan.textContent = t.name;
      itemEl.appendChild(labelSpan);

      // Create close button
      const closeBtn = document.createElement("button");
      closeBtn.className = "item-close-btn";
      closeBtn.title = "Kill Terminal";

      const closeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      closeSvg.setAttribute("width", "10");
      closeSvg.setAttribute("height", "10");
      closeSvg.setAttribute("viewBox", "0 0 16 16");
      closeSvg.setAttribute("fill", "currentColor");
      closeSvg.innerHTML =
        '<path d="M7.11 8l-4.57-4.57.89-.89 4.57 4.57 4.57-4.57.89.89-4.57 4.57 4.57 4.57-.89.89-4.57-4.57-4.57 4.57-.89-.89 4.57-4.57z"/>';
      closeBtn.appendChild(closeSvg);

      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: "killTerminal", terminalId: t.id });
      });
      itemEl.appendChild(closeBtn);

      // Select terminal action
      itemEl.addEventListener("click", () => {
        vscode.postMessage({ type: "focusTerminal", terminalId: t.id });
        menuPopup.style.display = "none";
      });

      menuTerminalList.appendChild(itemEl);
    });

    // 5. Update empty state visibility
    if (terminals.length === 0) {
      emptyState.style.display = "flex";
      terminalContainer.style.display = "none";
    } else {
      emptyState.style.display = "none";
      terminalContainer.style.display = "block";
    }
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "terminalList": {
        renderTerminals(msg.terminals);
        break;
      }
      case "data": {
        const inst = terminalInstances.get(msg.terminalId);
        if (inst) {
          if (inst.backlogReceived) {
            inst.term.write(msg.data);
          } else {
            inst.pendingData.push(msg.data);
          }
        }
        break;
      }
      case "backlog": {
        const inst = terminalInstances.get(msg.terminalId);
        if (inst) {
          inst.term.write(msg.data);
          for (const d of inst.pendingData) {
            inst.term.write(d);
          }
          inst.pendingData = [];
          inst.backlogReceived = true;
        }
        break;
      }
    }
  });

  // Focus terminal when clicking inside the container
  terminalContainer.addEventListener("click", () => {
    if (activeTerminalId) {
      const inst = terminalInstances.get(activeTerminalId);
      if (inst) {
        inst.term.focus();
      }
    }
  });

  // Toggle menu display
  stackBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isVisible = menuPopup.style.display === "flex";
    menuPopup.style.display = isVisible ? "none" : "flex";
  });

  // Close menu when clicking outside
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!stackBtn.contains(target) && !menuPopup.contains(target)) {
      menuPopup.style.display = "none";
    }
  });

  // New Terminal action in menu
  menuNewTerminal.addEventListener("click", () => {
    vscode.postMessage({ type: "createTerminal" });
    menuPopup.style.display = "none";
  });

  // Signal that webview is ready to load terminals
  vscode.postMessage({ type: "ready" });
})();
