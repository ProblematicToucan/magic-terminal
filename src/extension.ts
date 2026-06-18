import * as vscode from 'vscode';
import { SidebarViewProvider } from './sidebarViewProvider';

export function activate(context: vscode.ExtensionContext) {
  console.log('SideTerm is now active!');

  const provider = new SidebarViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'sideterm.terminalView',
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sideterm.toggle', () => {
      vscode.commands.executeCommand('workbench.view.extension.sideterm-sidebar');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sideterm.newTerminal', () => {
      provider.createNewTerminal();
      vscode.commands.executeCommand('workbench.view.extension.sideterm-sidebar');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sideterm.killTerminal', () => {
      provider.killActiveTerminal();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sideterm.insertFileReference', () => {
      provider.insertFileReference();
    }),
  );

  context.subscriptions.push(provider);
}

export function deactivate() {}
