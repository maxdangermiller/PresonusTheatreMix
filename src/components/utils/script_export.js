// components/utils/script_export.js
// File → Export Annotated Script: the show's script with each cue's number where it happens
// (like a prompt book: a tag just before the line it's on, with a rule across the page), and a
// cue sheet at the end: every cue, its page and who's on each DCA. Tags go next to the text,
// not in the outer margin, which viewers often trim and people write their own notes in.

import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

import { script_marks, sorted_cues, show_dcas, cue_key, parse_channels, dca_field } from '../../utils/show_edits.js';
import { format_cue_number } from '../../utils/cue_number.js';
import { get_DCA_label } from './cue_utils.js';

const TAG = rgb(0.0, 0.36, 0.85);
const SONG = rgb(0.55, 0.16, 0.62);
const GREY = rgb(0.35, 0.35, 0.35);

/**
 * PDF text can only use the standard font's characters: swap typographic ones for plain
 * @param {String} text
 */
const plain = (text) => String(text ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...")
	.replace(/[^\x20-\x7e]/g, "");

/**
 * A page's coordinates as it's shown (points from the top-left, rotation applied: what marks and
 * text lines use) -> the PDF's own (from the bottom-left, before rotation), like pdf.js's viewport
 * @param {import('pdf-lib').PDFPage} page
 * @returns {{at: (x: Number, y: Number) => {x: Number, y: Number}, angle: Number, width: Number}}
 *   at: a shown point in the PDF's coordinates; angle: to draw text upright; width: shown width
 */
const page_space = (page) => {
	const box = page.getCropBox();
	const rotation = ((page.getRotation().angle % 360) + 360) % 360;
	const [a, b, c, d] = {0: [1, 0, 0, -1], 90: [0, 1, 1, 0], 180: [-1, 0, 0, 1], 270: [0, -1, -1, 0]}[rotation] ?? [1, 0, 0, -1];
	const sideways = rotation === 90 || rotation === 270;
	const W = sideways ? box.height : box.width, H = sideways ? box.width : box.height;
	const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
	return {
		at: (X, Y) => ({x: cx + a * (X - W / 2) + b * (Y - H / 2), y: cy + c * (X - W / 2) + d * (Y - H / 2)}),
		angle: Math.atan2(c, a) * 180 / Math.PI,
		width: W,
	};
}

/**
 * The annotated script
 * @param {Uint8Array} bytes the script PDF
 * @param {Object} show
 * @param {import('../../utils/script_parse.js').ScriptLine[]} lines the script's text lines (to put tags beside them)
 * @returns {Promise<Uint8Array>} the new PDF
 */
const annotate_script = async (bytes, show, lines = []) => {
	const pdf = await PDFDocument.load(bytes, {ignoreEncryption: true});
	const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
	const regular = await pdf.embedFont(StandardFonts.Helvetica);
	const marks = script_marks(show);
	const cues = sorted_cues(show).filter((c) => Number(c.number) || Number(c.point));
	const pages = pdf.getPages();

	// Each cue's number just before its line, with a rule across the page above it
	for (const cue of cues) {
		const mark = marks[cue_key(cue)];
		const page = pages[(mark?.page ?? 0) - 1];
		if (!page) continue;
		// Worked out on the page as it's shown, then turned into the PDF's own coordinates
		const space = page_space(page);
		const label = format_cue_number(cue.number, cue.point);
		const song = !Number(cue.point);
		const color = song ? SONG : TAG;
		const size = 10;
		const w = bold.widthOfTextAtSize(label, size) + 8;
		// Just before the line the cue is on (else the page's left edge)
		const line = lines.filter((l) => l.page === mark.page && Math.abs(l.y - mark.y) < 8)
			.sort((a, b) => Math.abs(a.y - mark.y) - Math.abs(b.y - mark.y))[0];
		const X = Math.max(4, line ? line.x - w - 6 : 4);
		const rotate = degrees(space.angle);
		page.drawRectangle({...space.at(X, mark.y + size + 2), width: w, height: size + 5, color, opacity: 0.9, rotate});
		page.drawText(label, {...space.at(X + 4, mark.y + size - 0.5), size, font: bold, color: rgb(1, 1, 1), rotate});
		page.drawLine({start: space.at(10, mark.y - 3), end: space.at(space.width - 10, mark.y - 3), thickness: 0.5, color, opacity: 0.4});
	}

	// The cue sheet
	const dcas = show_dcas(show);
	const sheetSize = [612, 792];
	let page = null, y = 0;
	const newPage = () => {
		page = pdf.addPage(sheetSize);
		y = sheetSize[1] - 50;
		page.drawText("Cue Sheet", {x: 40, y, size: 16, font: bold});
		page.drawText(plain(`${show.config?.designer ? `${show.config.designer} - ` : ""}${cues.length} cues`), {x: 140, y: y + 2, size: 9, font: regular, color: GREY});
		y -= 24;
	}
	newPage();
	for (const cue of cues) {
		const who = dcas.map((d) => parse_channels(cue[dca_field(d, 'Channels')]).length ? `${d} ${get_DCA_label(show, cue, d)}` : null).filter(Boolean).join("  ");
		const lines = wrap(plain(who || "-"), regular, 8, 330);
		const height = 12 + lines.length * 10;
		if (y - height < 40) newPage();
		const mark = marks[cue_key(cue)];
		page.drawText(format_cue_number(cue.number, cue.point), {x: 40, y, size: 10, font: bold, color: Number(cue.point) ? TAG : SONG});
		page.drawText(mark ? `p.${mark.page}` : "", {x: 82, y, size: 8, font: regular, color: GREY});
		page.drawText(plain(cue.name).slice(0, 60), {x: 112, y, size: 9, font: Number(cue.point) ? regular : bold});
		lines.forEach((line, i) => page.drawText(line, {x: 112, y: y - 11 - i * 10, size: 8, font: regular, color: GREY}));
		y -= height;
	}
	return pdf.save();
}

/** Split text into lines that fit a width */
const wrap = (text, font, size, width) => {
	const lines = [];
	let line = "";
	for (const word of text.split(" ")) {
		const next = line ? `${line} ${word}` : word;
		if (font.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = word; } else line = next;
	}
	if (line) lines.push(line);
	return lines;
}

export { annotate_script };
