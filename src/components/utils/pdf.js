// components/utils/pdf.js
// pdf.js for the windows: opening the show's script (ScriptView, ScriptImportDialog). Each script
// file is opened once and shared.

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { read_lines, unreadable_pages } from '../../utils/script_pdf.js';
import { tesseract_pages } from './ocr.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** path -> Promise<{doc, file}> */
const opened = new Map();

/**
 * Open a script PDF (read by the main process)
 * @param {String} file
 * @returns {Promise<{doc: import('pdfjs-dist').PDFDocumentProxy, file: String, bytes: Uint8Array}>}
 */
const open_script = (file) => {
	if (!opened.has(file)) {
		opened.set(file, (async () => {
			const result = await window.scriptApi.read(file);
			if (!result.ok) throw new Error(result.error);
			// pdf.js takes ownership of the data it's given: keep a copy for exporting
			const bytes = new Uint8Array(result.bytes);
			const doc = await pdfjs.getDocument({data: new Uint8Array(bytes)}).promise;
			return {doc, file: result.file, bytes};
		})());
		opened.get(file).catch(() => opened.delete(file));
	}
	return opened.get(file);
}

/** path -> Promise<{lines, scanned, error}> */
const read = new Map();
/** path -> progress callbacks of everyone waiting for it */
const listeners = new Map();

/**
 * A script's text lines (utils/script_pdf.js). Pages with no readable text (scanned) are read
 * with the Mac's text recognition (main/script.js), which takes about a second a page the
 * first time; the result is kept.
 * @param {String} file
 * @param {(progress: {done: Number, total: Number}) => void} [onProgress] while scanned pages are read
 * @returns {Promise<{lines: import('../../utils/script_parse.js').ScriptLine[], scanned: Number, error: String | null}>}
 *   scanned: pages read by text recognition; error: why scanned pages couldn't be read
 */
const script_lines = (file, onProgress) => {
	if (!listeners.has(file)) listeners.set(file, new Set());
	if (onProgress) listeners.get(file).add(onProgress);
	if (!read.has(file)) {
		read.set(file, (async () => {
			const {doc} = await open_script(file);
			let lines = await read_lines(doc);
			const scanned = unreadable_pages(lines, doc.numPages);
			if (!scanned.length || !window.scriptApi?.ocr) return {lines, scanned: 0, error: null};
			const progress = (p) => { for (const listener of listeners.get(file) ?? []) listener(p); };
			// The Mac's own text recognition, else Tesseract (any system). localStorage
			// scriptOcr = "tesseract" uses Tesseract on a Mac too (for testing it).
			let result = {ok: false, native: false};
			let forced = false;
			try { forced = localStorage.getItem('scriptOcr') === 'tesseract'; } catch { /* no storage */ }
			if (!forced) {
				const stop = window.scriptApi.onOcrProgress(progress);
				result = await window.scriptApi.ocr(file, scanned);
				stop();
			}
			if (!result.ok && result.native === false) result = await tesseract_pages(file, doc, scanned, progress);
			listeners.delete(file);
			if (!result.ok) return {lines, scanned: 0, error: result.error};
			const ocr = Object.entries(result.pages).flatMap(([page, {width, height, lines: found}]) =>
				found.map((l) => ({page: Number(page), x: l.x, y: l.y, width: l.width, height: l.height, text: l.text, pageWidth: width, pageHeight: height})));
			const replaced = new Set(Object.keys(result.pages).map(Number));
			lines = [...lines.filter((l) => !replaced.has(l.page)), ...ocr].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
			return {lines, scanned: replaced.size, error: null};
		})());
		read.get(file).catch(() => read.delete(file));
	}
	return read.get(file);
}

export { open_script, script_lines };
