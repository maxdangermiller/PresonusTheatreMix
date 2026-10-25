// main/cueInfo.js
// What's happening in the show, for the windows that follow it:
//  - the active cue and the next one (View → Active Cue Info, a pop-out window)
//  - cue marks and notes made during a run (Action → Mark ... Cue, File → Export Notes).
//    Like TheatreMix, marks last for the session and aren't saved in the show.

import { app, BrowserWindow, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import { getShow, getShowPath, showEvents } from './showManager.js';
import { getMainWindow } from './windowManager.js';
import { next_cue } from '../utils/dca_state.js';
import { cue_key } from '../utils/show_edits.js';
import { format_cue_number } from '../utils/cue_number.js';
import { themeBackground } from './theme.js';

/** Key of the active cue ("number.point"), or null for Line Checks / nothing fired */
let activeKey = null;
let activeWindow = null;

/** @type {{key: String, cue: String, name: String, note: String, time: String}[]} */
let marks = [];

/** {number, name, colour} for a cue (Line Checks for null) */
const describe = (cue) => cue === null
	? {key: null, number: "0", name: "Line Checks", colour: 0}
	: {key: cue_key(cue), number: format_cue_number(cue.number, cue.point), name: cue.name ?? "", colour: Number(cue.colour) || 0};

/** The active and next cue, by the show as it is now (names or numbers may have been edited) */
const getActiveCueInfo = () => {
	const cues = getShow()?.cues ?? [];
	const cue = activeKey === null ? null : cues.find((c) => cue_key(c) === activeKey) ?? null;
	const next = getShow() ? next_cue(cues, cue) : null;
	return {current: describe(cue), next: next ? describe(next) : null, marked: new Set(marks.map((m) => m.key)).has(activeKey)};
}

const broadcast = () => {
	const info = getActiveCueInfo();
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.webContents.send('active-cue', info);
	}
}

/**
 * A cue was fired (null: Line Checks)
 * @param {Object | null} cue
 */
const setActiveCue = (cue) => {
	activeKey = cue === null ? null : cue_key(cue);
	broadcast();
}

// Edits can rename / renumber / remove the active cue or change what's next
showEvents.on('changed', () => {
	if (activeKey !== null && !getShow()?.cues.some((c) => cue_key(c) === activeKey)) activeKey = null;
	broadcast();
});

/**
 * View → Active Cue Info: a resizable pop-out window with the current and next cue
 */
const openActiveCueWindow = () => {
	if (activeWindow && !activeWindow.isDestroyed()) {
		activeWindow.focus();
		return;
	}
	activeWindow = new BrowserWindow({
		width: 800,
		height: 200,
		minWidth: 300,
		minHeight: 120,
		title: "Active Cue Info",
		backgroundColor: themeBackground(),
		webPreferences: {preload: path.join(__dirname, 'preload.cjs')},
	});
	activeWindow.setMenuBarVisibility(false);
	if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
		activeWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/active-cue/`);
	} else {
		activeWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {hash: '/active-cue/'});
	}
	activeWindow.on('closed', () => { activeWindow = null; });
}

/**
 * Mark a cue with a note (Action → Mark Selected / Current Cue). A second mark on the same cue
 * replaces its note.
 * @param {String | null} key cue key, or null for Line Checks
 * @param {String} note
 */
const markCue = (key, note) => {
	const cue = key === null ? null : getShow()?.cues.find((c) => cue_key(c) === key) ?? null;
	const {number, name} = describe(cue);
	const entry = {key, cue: number, name, note: String(note ?? "").trim(), time: new Date().toLocaleTimeString()};
	const at = marks.findIndex((m) => m.key === key);
	if (at >= 0) marks[at] = entry; else marks.push(entry);
	broadcast();
	return getMarks();
}

const getMarks = () => marks.map((m) => ({...m}));

/** A new show (or none): its marks start over */
const clearMarks = () => {
	marks = [];
	activeKey = null;
	broadcast();
}

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

/**
 * File → Export Notes: the session's marks as an HTML page
 * @returns {Promise<boolean>} true if saved
 */
const exportNotes = async () => {
	const window = getMainWindow();
	if (!marks.length) {
		await dialog.showMessageBox(window, {type: 'info', message: "No cues are marked", detail: "Mark cues during a run with Action → Mark Selected Cue (⌘R) or Mark Current Cue (⇧⌘R), then export their notes."});
		return false;
	}
	const showName = getShowPath() ? path.parse(getShowPath()).name : "New Show";
	const result = await dialog.showSaveDialog(window, {
		title: "Export Notes",
		defaultPath: path.join(getShowPath() ? path.dirname(getShowPath()) : app.getPath('documents'), `${showName} notes.html`),
		filters: [{name: 'Web page', extensions: ['html']}],
	});
	if (result.canceled || !result.filePath) return false;

	const sorted = [...marks].sort((a, b) => (a.key === null ? -1 : b.key === null ? 1 : Number(a.key.split(".")[0]) - Number(b.key.split(".")[0]) || Number(a.key.split(".")[1]) - Number(b.key.split(".")[1])));
	const rows = sorted.map((m) => `<tr><td>${escape(m.cue)}</td><td>${escape(m.name)}</td><td>${escape(m.note).replace(/\n/g, "<br>")}</td><td>${escape(m.time)}</td></tr>`).join("\n");
	const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escape(showName)} notes</title>
<style>body{font-family:-apple-system,Arial,sans-serif;margin:2em;color:#111}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;vertical-align:top}th{background:#eee}td:first-child{white-space:nowrap}</style>
</head><body>
<h1>${escape(showName)}: cue notes</h1>
<p>${escape(new Date().toLocaleString())}${getShow()?.config?.venue ? ` · ${escape(getShow().config.venue)}` : ""}</p>
<table><thead><tr><th>Cue</th><th>Text</th><th>Note</th><th>Marked</th></tr></thead>
<tbody>
${rows}
</tbody></table>
</body></html>
`;
	fs.writeFileSync(result.filePath, html);
	return true;
}

export { getActiveCueInfo, setActiveCue, openActiveCueWindow, markCue, getMarks, clearMarks, exportNotes };
