import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

import { SidebarViewProvider } from '../sidebarViewProvider';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('Instantiate SidebarViewProvider', () => {
		const dummyUri = vscode.Uri.file(__dirname);
		const provider = new SidebarViewProvider(dummyUri);
		assert.ok(provider);
		
		// Attempt to create a PTY terminal process to test node-pty spawning
		try {
			provider.createNewTerminal();
		} catch (err) {
			console.error('CRITICAL ERROR spawning terminal:', err);
			throw err;
		}
		
		provider.dispose();
	});
});
