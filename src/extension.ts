// Suppress Node.js punycode deprecation (DEP0040) — triggered by dependencies in the Extension Host
const _emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args: any[]) {
  if (typeof warning === 'string' && warning.includes('punycode')) return;
  if (warning && typeof warning === 'object' && (warning as any).code === 'DEP0040') return;
  return _emitWarning.call(process, warning, ...args);
};

import * as vscode from 'vscode';
import { SidebarViewProvider } from './sidebarViewProvider';

export function activate(context: vscode.ExtensionContext) {
  console.log('Magic Terminal is now active!');

  const provider = new SidebarViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'magic-terminal.terminalView',
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('magic-terminal.toggle', () => {
      vscode.commands.executeCommand('workbench.view.extension.magic-terminal-sidebar');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('magic-terminal.newTerminal', () => {
      provider.createNewTerminal();
      vscode.commands.executeCommand('workbench.view.extension.magic-terminal-sidebar');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('magic-terminal.killTerminal', () => {
      provider.killActiveTerminal();
    }),
  );

  context.subscriptions.push(provider);
}

export function deactivate() {}
