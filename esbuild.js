const esbuild = require("esbuild");
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
				postBuild();
			} catch (e) {
				console.error('Failed post-build step:', e);
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
	let css = fs.readFileSync(src, 'utf8');
	if (production) {
		css = css
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/\s+/g, ' ')
			.replace(/\s*([{}:;,])\s*/g, '$1')
			.replace(/;}/g, '}')
			.trim();
	}
	fs.writeFileSync(dest, css);
}

function postBuild() {
	if (!production) return;

	copyXtermCss();

	// Gzip the intermediate xterm IIFE
	const vendorDir = path.join(__dirname, 'dist', 'vendor');
	const raw = path.join(vendorDir, '_xterm.js');
	const gz = path.join(vendorDir, 'xterm-core.gz');
	if (fs.existsSync(raw)) {
		const code = fs.readFileSync(raw);
		fs.writeFileSync(gz, zlib.gzipSync(code));
		fs.rmSync(raw);
	}

	// Write the loader that fetches .gz and decompresses via DecompressionStream
	if (!fs.existsSync(vendorDir)) {
		fs.mkdirSync(vendorDir, { recursive: true });
	}
	const loaderCode = `"use strict";(function(){var c=window.__xtermCore;var w=window.__webview;function l(u,n){var s=document.createElement('script');if(n)s.onload=n;s.src=u;document.head.appendChild(s)}fetch(c).then(function(r){return r.arrayBuffer()}).then(function(b){var ds=new DecompressionStream('gzip');var wr=ds.writable.getWriter();wr.write(new Uint8Array(b));wr.close();return new Response(ds.readable).text()}).then(function(x){var bl=new Blob([x],{type:'text/javascript'});l(URL.createObjectURL(bl),function(){l(w)})}).catch(function(e){console.error('xterm loader:',e);l(w)})})();`;
	fs.writeFileSync(path.join(vendorDir, 'xterm-loader.js'), loaderCode);
}

async function main() {
	const baseConfig = production ? {
		drop: ['console', 'debugger'],
		legalComments: 'none',
	} : {};

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
		...baseConfig,
	});

	// Xterm + addons bundled into one IIFE, then post-gzipped
	const vendorCtx = await esbuild.context({
		entryPoints: ['src/vendor-terminal.ts'],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: false,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/vendor/_xterm.js',
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
		...baseConfig,
		mangleProps: production ? /^_/ : undefined,
	});

	// Webview frontend (lightweight IIFE)
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
		...baseConfig,
	});

	if (watch) {
		await extensionCtx.watch();
		await vendorCtx.watch();
		await webviewCtx.watch();
	} else {
		await extensionCtx.rebuild();
		await vendorCtx.rebuild();
		await webviewCtx.rebuild();
		await extensionCtx.dispose();
		await vendorCtx.dispose();
		await webviewCtx.dispose();
		if (!production) {
			copyXtermCss();
		}
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
