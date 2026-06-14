const esbuild = require("esbuild");
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
			try {
				copyXtermCss();
			} catch (e) {
				console.error('Failed to copy xterm.css:', e);
			}
		});
	},
};

function copyXtermCss() {
	const src = path.join(__dirname, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css');
	const destDir = path.join(__dirname, 'dist');
	const dest = path.join(destDir, 'xterm.css');
	if (!fs.existsSync(destDir)) {
		fs.mkdirSync(destDir, { recursive: true });
	}
	fs.copyFileSync(src, dest);
}

async function main() {
	// Extension Host config
	const extensionCtx = await esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode', 'node-pty'],
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
	});

	// Webview frontend config
	const webviewCtx = await esbuild.context({
		entryPoints: ['src/webview.ts'],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/webview.js',
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
	});

	if (watch) {
		await extensionCtx.watch();
		await webviewCtx.watch();
	} else {
		await extensionCtx.rebuild();
		await webviewCtx.rebuild();
		await extensionCtx.dispose();
		await webviewCtx.dispose();
		copyXtermCss();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
