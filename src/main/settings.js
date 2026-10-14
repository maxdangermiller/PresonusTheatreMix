// main/settings.js
// App preferences that persist between launches (stored in the user data folder)

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// TheatreMix keeps 4 recent shows (⌘1 - ⌘4)
const MAX_RECENT_FILES = 4;

const ROW_SIZES = ['small', 'medium', 'large'];

// Console Setup → Cue Display → Main fader label
const MAIN_LABEL_CHOICES = ['off', 'current', 'next'];

// Settings → cue list font size (px)
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 48;
// A resized cue list column can't be narrower or wider than this (px)
const MIN_COLUMN_WIDTH = 30;
const MAX_COLUMN_WIDTH = 2000;

const DEFAULTS = {
	/** @type {String[]} most recent first */
	recentFiles: [],
	/** @type {'small' | 'medium' | 'large'} cue list row size */
	rowSize: 'medium',
	/** @type {Number | null} Settings → cue list font size (px); null: the Row Size preset's */
	fontSize: null,
	/** @type {Object<string, number>} cue list column widths (px) dragged by the user: 'cue', 'text', 'qlab', 'dca1'... */
	columnWidths: {},
	/** View → Positions: position codes in the cue list's DCA cells */
	showPositions: false,
	/** View → Color-Blind DCA Colors: TheatreMix's color-blind palette (cue list and console) */
	colorBlindDca: false,
	/** Prevent edits (e.g. DCA levels) in the cue list */
	lockEditing: false,
	/** A person's DCA fader level follows them when they move to another DCA */
	levelsFollowPeople: true,
	/** Going Back into a cue restores its DCA faders and mutes as they were when it was left */
	restoreOnBack: true,
	/** Console Setup → Cue Display: the current / next cue on the console's Scenes screen */
	cueOnScenesScreen: true,
	/** Console Setup → Cue Display: the current / next cue on the two DCAs after the show's */
	cueOnSpareDcas: true,
	/** @type {'off' | 'current' | 'next'} Console Setup → Cue Display: what the main fader's scribble strip shows */
	cueOnMain: 'off',
	/** On launch, connect to the last console if it's found */
	autoConnect: true,
	/** @type {{host: String, port: Number, name: String | null, serial: String | null} | null} last console connected to */
	lastConsole: null,
};

// On/off preferences, checked when loading
const BOOLEAN_SETTINGS = ['lockEditing', 'levelsFollowPeople', 'restoreOnBack', 'autoConnect', 'showPositions', 'colorBlindDca', 'cueOnScenesScreen', 'cueOnSpareDcas'];

let settings = null;

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

/**
 * Get all settings (loaded from disk on first use)
 * @returns {typeof DEFAULTS}
 */
function getSettings() {
	if (settings !== null) return settings;

	settings = {...DEFAULTS};

	try {
		const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));

		if (Array.isArray(saved.recentFiles)) settings.recentFiles = saved.recentFiles.filter((f) => typeof f === 'string');
		if (ROW_SIZES.includes(saved.rowSize)) settings.rowSize = saved.rowSize;
		settings.fontSize = clean_font_size(saved.fontSize);
		settings.columnWidths = clean_column_widths(saved.columnWidths);
		for (const key of BOOLEAN_SETTINGS) {
			if (typeof saved[key] === 'boolean') settings[key] = saved[key];
		}
		if (MAIN_LABEL_CHOICES.includes(saved.cueOnMain)) settings.cueOnMain = saved.cueOnMain;
		if (typeof saved.lastConsole?.host === 'string') settings.lastConsole = saved.lastConsole;
	} catch {
		// No settings yet (first launch) or unreadable - use defaults, and carry over
		// the shows from the OS recent documents list the app used before
		try {
			settings.recentFiles = app.getRecentDocuments()
				.filter((f) => ['.tmix', '.tmixp', '.db'].includes(path.extname(f).toLowerCase()))
				.slice(0, MAX_RECENT_FILES);
		} catch {
			// getRecentDocuments isn't available on every platform
		}
	}

	return settings;
}

/**
 * A font size in range, or null
 * @param {*} size
 */
function clean_font_size(size) {
	const n = Math.round(Number(size));
	return size !== null && Number.isFinite(n) ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, n)) : null;
}

/**
 * Column widths in range (anything else dropped)
 * @param {*} widths
 */
function clean_column_widths(widths) {
	if (!widths || typeof widths !== 'object') return {};
	return Object.fromEntries(Object.entries(widths)
		.filter(([col, w]) => /^(cue|text|qlab|dca\d+)$/.test(col) && Number.isFinite(Number(w)))
		.map(([col, w]) => [col, Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(Number(w))))]));
}

/** What the cue list needs to know about the view (sent to the renderer) */
function viewSettings() {
	const {rowSize, fontSize, columnWidths, lockEditing, showPositions, colorBlindDca} = getSettings();
	return {rowSize, fontSize, columnWidths, lockEditing, showPositions, colorBlindDca};
}

/**
 * Update and persist settings
 * @param {Partial<typeof DEFAULTS>} changes
 */
function updateSettings(changes) {
	settings = {...getSettings(), ...changes};

	try {
		fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, '\t'));
	} catch (error) {
		console.warn("[settings]: Failed to save settings", error);
	}
}

/**
 * Move a show to the top of the recent list
 * @param {String} filePath
 */
function addRecentFile(filePath) {
	const recentFiles = [
		filePath,
		...getSettings().recentFiles.filter((f) => path.resolve(f) !== path.resolve(filePath))
	].slice(0, MAX_RECENT_FILES);

	updateSettings({recentFiles});
	app.addRecentDocument(filePath);
}

/**
 * Drop a show from the recent list (e.g. it was moved or deleted)
 * @param {String} filePath
 */
function removeRecentFile(filePath) {
	updateSettings({
		recentFiles: getSettings().recentFiles.filter((f) => path.resolve(f) !== path.resolve(filePath))
	});
}

export {
	ROW_SIZES,
	MAIN_LABEL_CHOICES,
	MIN_FONT_SIZE,
	MAX_FONT_SIZE,
	clean_font_size,
	clean_column_widths,
	viewSettings,
	getSettings,
	updateSettings,
	addRecentFile,
	removeRecentFile,
};
