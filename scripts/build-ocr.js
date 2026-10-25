// Builds native/script-ocr (macOS text recognition for scanned scripts) into
// native-bin/script-ocr, for both Apple Silicon and Intel Macs. Skipped when it's up to date,
// and on other systems (the app then can't read scanned scripts, only ones with text).
// Run by "npm start", "npm run package" and "npm run make".

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'native', 'script-ocr', 'main.swift');
const out = path.join(root, 'native-bin', 'script-ocr');

if (process.platform !== 'darwin') {
	console.log("[build-ocr] Not macOS: skipping the scanned-script reader");
	process.exit(0);
}
if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(source).mtimeMs) process.exit(0);

fs.mkdirSync(path.dirname(out), {recursive: true});
const built = [];
for (const arch of ['arm64', 'x86_64']) {
	const target = `${out}-${arch}`;
	try {
		execFileSync('swiftc', ['-O', '-target', `${arch}-apple-macos11`, '-o', target, source], {stdio: 'inherit'});
		built.push(target);
	} catch {
		console.warn(`[build-ocr] Couldn't build for ${arch}`);
	}
}
if (!built.length) {
	console.warn("[build-ocr] swiftc failed (install Xcode's command line tools: xcode-select --install). Scanned scripts can't be read.");
	process.exit(0);
}
execFileSync('lipo', ['-create', '-output', out, ...built]);
for (const file of built) fs.rmSync(file);
console.log(`[build-ocr] Built ${path.relative(root, out)}`);
