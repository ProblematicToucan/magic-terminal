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

  context.subscriptions.push(
    vscode.commands.registerCommand('magic-terminal.insertFileReference', () => {
      provider.insertFileReference();
    }),
  );

  context.subscriptions.push(provider);
}

export function deactivate() {}
