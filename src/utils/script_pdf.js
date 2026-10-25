// utils/script_pdf.js
// A PDF's text as lines with positions, for utils/script_parse.js. Takes a document already
// opened with pdf.js, so it works in the app (components/ScriptView.jsx) and in plain Node.

/**
 * Every line of text in the document, page by page, top to bottom, in the page's own
 * coordinates as it's shown (PDF points from the top-left, rotation applied)
 * @param {import('pdfjs-dist').PDFDocumentProxy} doc
 * @param {Number[] | null} [pages] only these pages
 * @returns {Promise<import('./script_parse.js').ScriptLine[]>}
 */
const read_lines = async (doc, pages = null) => {
	const lines = [];
	for (let p = 1; p <= doc.numPages; p++) {
		if (pages && !pages.includes(p)) continue;
		const page = await doc.getPage(p);
		// Positions as the page is shown (rotation and crop applied), from its top-left corner
		const viewport = page.getViewport({scale: 1});
		const content = await page.getTextContent();
		const rows = [];
		for (const item of content.items) {
			if (!item.str || !item.str.trim()) continue;
			const [a, b, c, d, tx, ty] = item.transform;
			const size = Math.hypot(c, d) || 10;
			const along = Math.hypot(a, b) || 1;
			const [x0, y0] = viewport.convertToViewportPoint(tx, ty);
			const [x1, y1] = viewport.convertToViewportPoint(tx + (a / along) * item.width, ty + (b / along) * item.width);
			// Text that isn't upright on the page (a side tab, a margin note) isn't the play
			if (Math.abs(y1 - y0) > Math.abs(x1 - x0)) continue;
			const x = Math.min(x0, x1), y = y0, width = Math.abs(x1 - x0), height = item.height || size;
			// Same line: baselines within a third of the text height
			let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(2, height / 3));
			if (!row) rows.push(row = {y, height, items: []});
			row.items.push({x, width, str: item.str});
		}
		for (const row of rows.sort((a, b) => a.y - b.y)) {
			row.items.sort((a, b) => a.x - b.x);
			const first = row.items[0], last = row.items[row.items.length - 1];
			// Items on one line: a space where there's a gap between them
			let text = "";
			let end = null;
			for (const item of row.items) {
				if (end !== null && item.x - end > 1.5 && !text.endsWith(" ") && !item.str.startsWith(" ")) text += " ";
				text += item.str;
				end = item.x + item.width;
			}
			lines.push({
				page: p, y: row.y - row.height, x: first.x, width: last.x + last.width - first.x, height: row.height,
				text, pageWidth: viewport.width, pageHeight: viewport.height,
			});
		}
	}
	return lines;
}

/**
 * Pages whose text can't be read (scanned pictures, or text in a font with no character map,
 * which comes out as junk): these need OCR
 * @param {import('./script_parse.js').ScriptLine[]} lines read_lines' result
 * @param {Number} count pages in the document
 * @returns {Number[]}
 */
const unreadable_pages = (lines, count) => {
	const letters = new Map();
	for (const line of lines) letters.set(line.page, (letters.get(line.page) ?? 0) + (line.text.match(/[A-Za-z]/g) ?? []).length);
	return Array.from({length: count}, (_, i) => i + 1).filter((p) => (letters.get(p) ?? 0) < 40);
}

export { read_lines, unreadable_pages };
