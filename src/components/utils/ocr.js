// components/utils/ocr.js
// Reading scanned script pages on any system: each page is drawn with pdf.js and read with
// Tesseract (tesseract.js, WebAssembly), from the copy in public/tesseract/ (scripts/copy-tesseract.js),
// so it works offline. On a Mac the system's own text recognition is used instead when it's there
// (faster and more accurate: main/script.js).

import { createScheduler, createWorker, OEM, PSM } from 'tesseract.js';

// Pixels per point the page is drawn at (about 220 dpi: enough for script type)
const SCALE = 3;
// Pages read so far are kept every this many pages (so stopping part way loses little)
const SAVE_EVERY = 8;
// A page that takes longer than this to draw or read is skipped (the import goes on without it)
const DRAW_LIMIT_MS = 60000;
const READ_LIMIT_MS = 120000;

/** A promise, or an error if it takes longer than ms */
const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took too long`)), ms))]);

let scheduler = null;
let readers = 1;

/** Tesseract readers, one per couple of processor cores (up to 3) */
const get_scheduler = async () => {
	if (scheduler) return scheduler;
	const base = new URL('tesseract/', window.location.href).href;
	const count = Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
	readers = count;
	const s = createScheduler();
	for (let i = 0; i < count; i++) {
		const worker = await createWorker('eng', OEM.LSTM_ONLY, {
			workerPath: `${base}worker.min.js`, corePath: base, langPath: base, gzip: true, cacheMethod: 'none',
		});
		// A script page is one column: read that way, Tesseract keeps short lines on their own
		// (a speaker's name like "SKY" between two speeches is often dropped otherwise)
		await worker.setParameters({tessedit_pageseg_mode: PSM.SINGLE_COLUMN});
		s.addWorker(worker);
	}
	scheduler = s;
	return s;
}

/**
 * Read one page: its lines with their boxes, in points from the top-left as it's shown (the
 * same as the PDF's text and the Mac's reader)
 * @param {import('pdfjs-dist').PDFDocumentProxy} doc
 * @param {Number} number
 * @returns {Promise<{width: Number, height: Number, lines: {x, y, width, height, text}[]}>}
 */
const read_page = async (doc, number) => {
	const page = await doc.getPage(number);
	const viewport = page.getViewport({scale: SCALE});
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(viewport.width);
	canvas.height = Math.round(viewport.height);
	// Read back for dark bars below
	canvas.getContext('2d', {willReadFrequently: true});
	const task = page.render({canvasContext: canvas.getContext('2d'), viewport});
	try { await within(task.promise, DRAW_LIMIT_MS, `Drawing page ${number}`); } catch (error) { task.cancel(); throw error; }
	const s = await get_scheduler();
	const lines_of = (data) => data.lines ?? (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
	const {data} = await within(s.addJob('recognize', canvas), READ_LIMIT_MS, `Reading page ${number}`);
	const found = lines_of(data).map(clean_line).filter(Boolean);
	// White text on a dark bar (song headings often are) isn't read: read each bar turned over
	for (const band of dark_bands(canvas)) {
		const strip = inverted(canvas, band);
		const {data: inside} = await s.addJob('recognize', strip);
		for (const line of lines_of(inside).map(clean_line).filter(Boolean)) found.push({...line, y: line.y + band.top / SCALE});
		strip.width = strip.height = 0;
	}
	canvas.width = canvas.height = 0;
	return {width: viewport.width / SCALE, height: viewport.height / SCALE, lines: found.sort((a, b) => a.y - b.y)};
}

/**
 * Dark bars across the page (white-on-black headings): rows that are mostly dark, between
 * 10 and 100 points tall
 * @param {HTMLCanvasElement} canvas
 * @returns {{top: Number, bottom: Number}[]} in pixels
 */
const dark_bands = (canvas) => {
	const {width, height} = canvas;
	const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
	const dark_row = (y) => {
		let dark = 0, seen = 0;
		for (let x = 0; x < width; x += 6) {
			const i = (y * width + x) * 4;
			if (pixels[i] + pixels[i + 1] + pixels[i + 2] < 240) dark++;
			seen++;
		}
		return dark / seen > 0.45;
	};
	const bands = [];
	let start = null;
	for (let y = 0; y <= height; y++) {
		const dark = y < height && dark_row(y);
		if (dark && start === null) start = y;
		if (!dark && start !== null) {
			const tall = (y - start) / SCALE;
			if (tall >= 10 && tall <= 100) bands.push({top: Math.max(0, start - 4), bottom: Math.min(height, y + 4)});
			start = null;
		}
	}
	return bands;
}

/** A strip of the page with its colors turned over (white on black -> black on white) */
const inverted = (canvas, {top, bottom}) => {
	const strip = document.createElement('canvas');
	strip.width = canvas.width;
	strip.height = bottom - top;
	const context = strip.getContext('2d');
	const image = canvas.getContext('2d').getImageData(0, top, canvas.width, bottom - top);
	for (let i = 0; i < image.data.length; i += 4) {
		image.data[i] = 255 - image.data[i];
		image.data[i + 1] = 255 - image.data[i + 1];
		image.data[i + 2] = 255 - image.data[i + 2];
	}
	context.putImageData(image, 0, 0);
	return strip;
}

/** Specks on a scan come out as "words" with no letters or digits ("." ";" "]" "|") */
const is_speck = (word) => !/[A-Za-z0-9]/.test(word.text) && word.text.length <= 2;

/**
 * A line as the parser wants it: specks at its ends taken off (they also stretch its box to
 * the edge of the page, so a centered name wouldn't look centered), its box from its words
 * @returns {{x, y, width, height, text} | null}
 */
const clean_line = (line) => {
	const words = [...(line.words ?? [])];
	while (words.length && is_speck(words[0])) words.shift();
	while (words.length && is_speck(words[words.length - 1])) words.pop();
	const box = words.length
		? {x0: Math.min(...words.map((w) => w.bbox.x0)), x1: Math.max(...words.map((w) => w.bbox.x1)), y0: Math.min(...words.map((w) => w.bbox.y0)), y1: Math.max(...words.map((w) => w.bbox.y1))}
		: line.bbox;
	const text = (line.words ? words.map((w) => w.text).join(" ") : line.text).replace(/\s+/g, " ").trim();
	if (!text || !/[A-Za-z0-9]/.test(text)) return null;
	return {x: box.x0 / SCALE, y: box.y0 / SCALE, width: (box.x1 - box.x0) / SCALE, height: (box.y1 - box.y0) / SCALE, text};
}

/**
 * Read scanned pages with Tesseract, keeping what's read (pages read before come straight back)
 * @param {String} file the script
 * @param {import('pdfjs-dist').PDFDocumentProxy} doc
 * @param {Number[]} pages
 * @param {(progress: {done: Number, total: Number}) => void} onProgress
 * @returns {Promise<{ok: true, pages: Object<number, Object>} | {ok: false, error: String}>}
 */
const tesseract_pages = async (file, doc, pages, onProgress) => {
	const cached = await window.scriptApi.ocrCache(file, pages);
	if (!cached.ok) return cached;
	const result = {...cached.pages};
	const missing = pages.filter((p) => !result[p]);
	onProgress({done: pages.length - missing.length, total: pages.length});
	let unsaved = {};
	let skipped = 0;
	const save = async () => {
		if (!Object.keys(unsaved).length) return;
		const store = unsaved;
		unsaved = {};
		await window.scriptApi.ocrCache(file, [], store);
	};
	try {
		// A page per reader at a time (each page is a big picture while it's read)
		await get_scheduler();
		const queue = [...missing];
		const next = async () => {
			for (let number = queue.shift(); number !== undefined; number = queue.shift()) {
				let read;
				try {
					read = await read_page(doc, number);
				} catch (error) {
					console.warn(`[ocr] Skipped page ${number}: ${error.message}`);
					skipped++;
					continue;
				}
				result[number] = read;
				unsaved[number] = read;
				onProgress({done: Object.keys(result).length, total: pages.length});
				if (Object.keys(unsaved).length >= SAVE_EVERY) await save();
			}
		};
		await Promise.all(Array.from({length: readers}, next));
	} catch (error) {
		await save();
		return {ok: false, error: `Text recognition failed: ${error.message ?? error}`};
	}
	await save();
	return {ok: true, pages: result, skipped};
}

export { tesseract_pages };
