// Copies Tesseract (tesseract.js: text recognition that runs in the app, for scanned scripts on
// any system) into public/tesseract/, which the windows load it from: its worker, the engine
// (WebAssembly, with and without SIMD) and the English data. Bundled so it works offline.
// Run by "npm start", "npm run package" and "npm run make".

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public', 'tesseract');
const files = {
	'worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
	'tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
	'tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
	'eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};

fs.mkdirSync(out, {recursive: true});
let copied = 0;
for (const [name, from] of Object.entries(files)) {
	const source = path.join(root, from), target = path.join(out, name);
	if (!fs.existsSync(source)) { console.warn(`[copy-tesseract] Missing ${from}: run npm install`); continue; }
	if (fs.existsSync(target) && fs.statSync(target).mtimeMs >= fs.statSync(source).mtimeMs) continue;
	fs.copyFileSync(source, target);
	copied++;
}
if (copied) console.log(`[copy-tesseract] Copied ${copied} file(s) to public/tesseract`);
