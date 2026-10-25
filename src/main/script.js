// main/script.js
// The show's script (a PDF): picking it, reading it for the Script view and File → Import
// Script (components/ScriptView.jsx, ScriptImportDialog.jsx), and saving an annotated copy.

import { app, dialog } from 'electron';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { getMainWindow } from './windowManager.js';
import { getShowState } from './showManager.js';

/**
 * Pick a script PDF
 * @returns {Promise<String | null>} its path, or null if cancelled
 */
const chooseScript = async () => {
	const {canceled, filePaths} = await dialog.showOpenDialog(getMainWindow(), {
		title: "Choose the show's script",
		properties: ['openFile'],
		filters: [{name: 'PDF scripts', extensions: ['pdf']}],
	});
	return canceled || !filePaths.length ? null : filePaths[0];
}

/**
 * A script PDF's bytes. The show keeps the script's full path; if it's been moved along with the
 * show, a file of the same name next to the show is used.
 * @param {String} file
 * @returns {Promise<{ok: true, bytes: Uint8Array, file: String} | {ok: false, error: String}>}
 */
const readScript = async (file) => {
	const found = await findScript(file);
	if (!found) return {ok: false, error: typeof file === 'string' && file.toLowerCase().endsWith('.pdf') ? `Can't find the script: ${file}` : "Not a PDF"};
	return {ok: true, bytes: new Uint8Array(await fs.promises.readFile(found)), file: found};
}

/**
 * Where a script PDF is: its path, or a file of the same name next to the show
 * @param {String} file
 * @returns {Promise<String | null>}
 */
const findScript = async (file) => {
	if (typeof file !== 'string' || path.extname(file).toLowerCase() !== '.pdf') return null;
	const showPath = getShowState().path;
	for (const candidate of [file, ...(showPath ? [path.join(path.dirname(showPath), path.basename(file))] : [])]) {
		try { await fs.promises.access(candidate, fs.constants.R_OK); return candidate; } catch { /* next */ }
	}
	return null;
}

// #region Scanned scripts (OCR)

/** The scanned-script reader (native/script-ocr, built by scripts/build-ocr.js) */
const ocrReader = () => app.isPackaged ? path.join(process.resourcesPath, 'script-ocr') : path.join(app.getAppPath(), 'native-bin', 'script-ocr');

/**
 * Where a script's read pages are kept (the app's data folder), named for the file as it is now
 * @param {String} found the script's path
 */
const cacheFileFor = async (found) => {
	const stat = await fs.promises.stat(found);
	const key = crypto.createHash('sha1').update(`${found}|${stat.size}|${stat.mtimeMs}`).digest('hex');
	return path.join(app.getPath('userData'), 'script-ocr', `${key}.json`);
}

const readCache = async (cacheFile) => {
	try { return JSON.parse(await fs.promises.readFile(cacheFile, 'utf8')); } catch { return {pages: {}}; }
}

const writeCache = async (cacheFile, cache) => {
	await fs.promises.mkdir(path.dirname(cacheFile), {recursive: true});
	await fs.promises.writeFile(cacheFile, JSON.stringify(cache));
}

/**
 * Pages already read (by either reader), and keeping more: the windows read scanned pages with
 * Tesseract when the Mac's reader isn't there (components/utils/ocr.js)
 * @param {String} file
 * @param {Number[]} pages wanted
 * @param {Object<number, Object>} [store] pages just read, to keep
 * @returns {Promise<{ok: true, pages: Object<number, {width, height, lines}>} | {ok: false, error: String}>}
 */
const ocrCache = async (file, pages, store = null) => {
	const found = await findScript(file);
	if (!found) return {ok: false, error: `Can't find the script: ${file}`};
	const cacheFile = await cacheFileFor(found);
	const cache = await readCache(cacheFile);
	if (store && Object.keys(store).length) {
		Object.assign(cache.pages, store);
		await writeCache(cacheFile, cache);
	}
	return {ok: true, pages: Object.fromEntries(pages.map(Number).filter((p) => cache.pages[p]).map((p) => [p, cache.pages[p]]))};
}

/**
 * Read scanned pages' text with macOS's text recognition. Each script's pages are kept (in the
 * app's data folder) so a script is only read once. Other systems: {ok: false, native: false}
 * (the windows use Tesseract instead).
 * @param {Electron.WebContents} sender gets 'script-ocr-progress' {done, total}
 * @param {String} file
 * @param {Number[]} pages
 * @returns {Promise<{ok: true, pages: Object<number, {width, height, lines}>} | {ok: false, error: String}>}
 */
const ocrScript = async (sender, file, pages) => {
	const reader = ocrReader();
	if (process.platform !== 'darwin' || !fs.existsSync(reader)) return {ok: false, native: false, error: "The Mac's text recognition isn't available"};
	const found = await findScript(file);
	if (!found) return {ok: false, error: `Can't find the script: ${file}`};

	const cacheFile = await cacheFileFor(found);
	const cache = await readCache(cacheFile);

	const wanted = pages.map(Number).filter((p) => Number.isInteger(p) && p > 0);
	const missing = wanted.filter((p) => !cache.pages[p]);
	const report = () => { if (!sender.isDestroyed()) sender.send('script-ocr-progress', {done: wanted.filter((p) => cache.pages[p]).length, total: wanted.length}); };
	report();
	if (missing.length) {
		await new Promise((resolve) => {
			const child = spawn(reader, [found, missing.join(",")]);
			readline.createInterface({input: child.stdout}).on('line', (line) => {
				try {
					const page = JSON.parse(line);
					cache.pages[page.page] = {width: page.width, height: page.height, lines: page.lines};
					report();
				} catch { /* not a page */ }
			});
			child.on('error', resolve);
			child.on('close', resolve);
		});
		await writeCache(cacheFile, cache);
	}
	return {ok: true, pages: Object.fromEntries(wanted.filter((p) => cache.pages[p]).map((p) => [p, cache.pages[p]]))};
}

// #endregion

/**
 * File → Export Annotated Script: save the marked-up PDF
 * @param {Uint8Array} bytes
 * @param {String} suggested file name
 * @returns {Promise<String | null>} where it was saved
 */
const saveAnnotatedScript = async (bytes, suggested) => {
	const {canceled, filePath} = await dialog.showSaveDialog(getMainWindow(), {
		title: "Save the annotated script",
		defaultPath: suggested,
		filters: [{name: 'PDF', extensions: ['pdf']}],
	});
	if (canceled || !filePath) return null;
	await fs.promises.writeFile(filePath, Buffer.from(bytes));
	return filePath;
}

export { chooseScript, readScript, saveAnnotatedScript, ocrScript, ocrCache };
