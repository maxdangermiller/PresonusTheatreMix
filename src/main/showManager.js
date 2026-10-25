// main/showManager.js

import { app, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import DatabaseConnection from '../database/DatabaseConnection';
import ShowRepository from '../repositories/ShowRepository';
import ShowFile from '../models/ShowFile';

import { EventEmitter } from 'node:events';

import { dca_level_key, clamp_dca_level } from '../utils/dca_levels';
import { apply_edits } from '../utils/show_edits.js';
import { TMIX_SCHEMA, NEW_SHOW_CHANNELS, newShowConfig } from '../database/tmixSchema.js';
import { getMainWindow } from './windowManager.js';
import { addRecentFile } from './settings.js';

const APP_TITLE = "PreSonus TheatreMix";
const TMIXP_EXTENSION = ".tmixp";

/** @type {ShowFile} */
let currentShow = null;

/** @type {String} path the current show was loaded from / saved to */
let currentPath = null;

/**
 * File the show's TheatreMix data comes from on the next save. Usually currentPath,
 * but after merging a .tmix it's that .tmix until the merge is saved.
 * @type {String}
 */
let contentPath = null;

/** Unsaved changes (edits, merges) */
let dirty = false;

/**
 * Undo / redo history: the show's editable data before each edit (see snapshot())
 * @type {Object[]}
 */
let undoStack = [];
let redoStack = [];
const UNDO_LIMIT = 200;

// The parts of a show the editor changes (and undo puts back)
const EDITABLE = ['cues', 'profiles', 'ensembles', 'positions', 'actors', 'actorGroups', 'actorProfiles',
	'config', 'dcaLevels', 'consoleSetup', 'channelSettings'];

/** Emits 'changed' whenever the show, its path, dirty state or history changes (used by the menu) */
const showEvents = new EventEmitter();

/**
 * Update the window title / macOS "edited" dot
 */
function updateTitle() {
	const window = getMainWindow();
	if (!window || window.isDestroyed()) return;

	const name = currentPath ? path.basename(currentPath) : (currentShow ? "New Show" : "");
	window.setTitle(name ? `${name}${dirty ? " •" : ""} — ${APP_TITLE}` : APP_TITLE);

	// macOS only: shows the unsaved dot in the window's close button
	if (process.platform === 'darwin') {
		window.setDocumentEdited(dirty);
	}
}

function setDirty(value) {
	dirty = value;
	updateTitle();
	showEvents.emit('changed');
}

function clearHistory() {
	undoStack = [];
	redoStack = [];
}

/**
 * Load Show
 * @param {String} path to show file (.tmix, .tmixp or .db)
 * @returns {ShowFile} for loaded show
 */
function loadShow(path) {
	const db = new DatabaseConnection(path);

	const repo = new ShowRepository(db);

	try {
		currentShow = repo.load();
	} finally {
		db.close();
	}

	currentPath = path;
	contentPath = path;
	clearHistory();
	addRecentFile(path);
	setDirty(false);

	return currentShow;
}

/**
 * File → New Show: a blank show for a StudioLive 32, like TheatreMix's (every channel
 * "Channel N" and controlled, DCAs 1-8, one position, empty Male / Female ensembles, one cue). It has no file until
 * it's saved. Ask about unsaved changes first (confirmDiscardChanges).
 * @param {String} designer
 * @returns {ShowFile}
 */
function newShow(designer = "") {
	const show = new ShowFile();
	show.config = newShowConfig(designer);
	show.profiles = Array.from({length: NEW_SHOW_CHANNELS}, (_, i) => ({
		id: i + 1, channel: i + 1, name: `Channel ${i + 1}`, label: null, default: 1, data: "",
	}));
	show.positions = [{id: 0, name: "Centre Stage", shortName: "CS", delay: 0, pan: 0, buses: null}];
	// TheatreMix starts every show with empty Male and Female ensembles
	show.ensembles = [{id: 2, name: "Male", channels: "", channelProfiles: ""}, {id: 3, name: "Female", channels: "", channelProfiles: ""}];
	show.cues = [];
	apply_edits(show, [{op: 'insert_cue', after: null}]);
	// The first cue is 1, "New Cue" (inserting at the start would make it 0.5)
	Object.assign(show.cues[0], {number: 1, point: 0, name: "New Cue"});

	currentShow = show;
	currentPath = null;
	contentPath = null;
	clearHistory();
	setDirty(true);

	return currentShow;
}

/**
 * Close the current show (asks about unsaved changes first)
 * @returns {Promise<boolean>} true if closed
 */
async function closeShow() {
	if (currentShow === null) return true;
	if (!(await confirmDiscardChanges())) return false;

	currentShow = null;
	currentPath = null;
	contentPath = null;
	clearHistory();
	setDirty(false);

	return true;
}

/**
 * Info the menu needs to decide which items are enabled
 * @returns {{hasShow: boolean, isTmixp: boolean, canUndo: boolean, canRedo: boolean, qLabEnabled: boolean, canSave: boolean}}
 */
function getShowState() {
	return {
		hasShow: currentShow !== null,
		path: currentPath,
		isTmixp: is_tmixp(),
		// File → Import Script has been used: Export Annotated Script has something to export
		hasScript: Boolean(currentShow?.consoleSetup?.scriptFile),
		canUndo: undoStack.length > 0,
		canRedo: redoStack.length > 0,
		// TheatreMix: Show Setup → QLab → "Recall QLab cues"
		qLabEnabled: currentShow?.config?.qLabCues === "1",
		// Save Show has something to do: unsaved changes, or a .tmix to save as a .tmixp
		canSave: currentShow !== null && (dirty || !is_tmixp()),
	};
}

/** Is the open show a .tmixp (this app's show file)? A new show has no file yet */
function is_tmixp() {
	return currentPath !== null && path.extname(currentPath).toLowerCase() === TMIXP_EXTENSION;
}

/**
 * Path of the open show file
 * @returns {String | null}
 */
function getShowPath() {
	return currentPath;
}

/**
 * Get Show
 * @returns {ShowFile} for loaded show
 */
function getShow() {
	return currentShow;
}

/**
 * Has the show got unsaved changes?
 * @returns {boolean}
 */
function isShowDirty() {
	return currentShow !== null && dirty;
}

/**
 * Copy of the show's editable data, for undo
 */
function snapshot() {
	return structuredClone(Object.fromEntries(EDITABLE.map((key) => [key, currentShow[key]])));
}

/**
 * Apply edits (see utils/show_edits.js) as one undoable step
 * @param {{op: String}[]} ops
 * @returns {{show: ShowFile, results: Object[]}} the updated show, and each edit's result
 * @throws if an edit isn't possible (nothing is changed then)
 */
function editShow(ops) {
	if (currentShow === null) {
		throw new Error("No show is loaded");
	}

	const before = snapshot();
	let results;
	try {
		results = apply_edits(currentShow, ops);
	} catch (error) {
		Object.assign(currentShow, before);
		throw error;
	}

	undoStack.push(before);
	if (undoStack.length > UNDO_LIMIT) undoStack.shift();
	redoStack = [];
	setDirty(true);

	return {show: currentShow, results};
}

/**
 * Set (or clear) the level a DCA comes up at in a cue
 * @param {Number} number cue number
 * @param {Number} point cue point
 * @param {Number} dca DCA number
 * @param {Number | null} level dB, or null to use the default
 * @returns {Object} updated DCA level map
 */
function setDcaLevel(number, point, dca, level) {
	const value = (level === null || level === undefined) ? null : clamp_dca_level(Number(level));
	if ((currentShow?.dcaLevels[dca_level_key(number, point)]?.[dca] ?? null) !== value) {
		editShow([{op: 'set_dca_level', cue: dca_level_key(number, point), dca, level: value}]);
	}
	return currentShow.dcaLevels;
}

/**
 * Change a StudioLive console setting (saved in the .tmixp)
 * @param {String} param e.g. "muteButtonMap"
 * @param {String} value 
 * @returns {Object<string, string>} updated console setup
 */
function setConsoleSetup(param, value) {
	if (currentShow === null) {
		throw new Error("No show is loaded");
	}

	if (currentShow.consoleSetup[param] !== value) {
		currentShow.consoleSetup = {...currentShow.consoleSetup, [param]: value};
		setDirty(true);
	}

	return currentShow.consoleSetup;
}

/**
 * Undo the last edit
 * @returns {ShowFile | null} the show, or null if there was nothing to undo
 */
function undoEdit() {
	const before = undoStack.pop();
	if (!before || currentShow === null) return null;

	redoStack.push(snapshot());
	Object.assign(currentShow, before);
	setDirty(true);

	return currentShow;
}

/**
 * Redo the last undone edit
 * @returns {ShowFile | null} the show, or null if there was nothing to redo
 */
function redoEdit() {
	const after = redoStack.pop();
	if (!after || currentShow === null) return null;

	undoStack.push(snapshot());
	Object.assign(currentShow, after);
	setDirty(true);

	return currentShow;
}

/**
 * Write the show into a .tmixp file
 * The .tmixp is a copy of the source show file with the edited TheatreMix tables written
 * back in, plus this app's dcaLevels and consoleSetup tables, so anything TheatreMix
 * stores that the editor doesn't touch (caches, settings) is kept.
 *
 * Written to a temp file and then renamed over the target, so a failed save
 * never leaves a half-written show behind.
 * @param {String} targetPath
 */
function writeTmixp(targetPath) {
	const tempPath = `${targetPath}.saving`;

	if (contentPath) {
		fs.copyFileSync(contentPath, tempPath);
	} else {
		// A new show: make an empty TheatreMix show file first
		fs.rmSync(tempPath, {force: true});
		const db = new DatabaseConnection(tempPath);
		try {
			for (const sql of TMIX_SCHEMA) db.run(sql);
		} finally {
			db.close();
		}
	}

	try {
		const db = new DatabaseConnection(tempPath);

		try {
			const repo = new ShowRepository(db);
			repo.saveShowTables(currentShow);
			repo.saveDcaLevels(currentShow.dcaLevels);
			repo.saveConsoleSetup(currentShow.consoleSetup);
			repo.saveChannelSettings(currentShow.channelSettings);
		} finally {
			db.close();
		}

		fs.renameSync(tempPath, targetPath);
	} catch (error) {
		fs.rmSync(tempPath, {force: true});
		throw error;
	}

	currentPath = targetPath;
	contentPath = targetPath;
	addRecentFile(targetPath);
	setDirty(false);
}

/**
 * Save Show - saves in place if it's already a .tmixp, otherwise asks where to save one
 * @returns {Promise<boolean>} true if saved
 */
async function saveShow() {
	if (currentShow === null) return false;

	if (is_tmixp()) {
		return trySave(currentPath);
	}

	return saveShowAs();
}

/**
 * Write a .tmixp, reporting failures to the user
 * @param {String} targetPath 
 * @returns {boolean} true if saved
 */
function trySave(targetPath) {
	try {
		writeTmixp(targetPath);
		return true;
	} catch (error) {
		console.warn("[showManager]: Failed to save show", error);
		dialog.showErrorBox("Save Failed", `Could not save the show to ${targetPath}\r\n${error.message}`);
		return false;
	}
}

/**
 * Save Show As a new .tmixp file
 * @returns {Promise<boolean>} true if saved
 */
async function saveShowAs() {
	if (currentShow === null) return false;

	// Next to the show it came from, or in Documents for a new show
	const defaultPath = currentPath
		? path.join(path.parse(currentPath).dir, path.parse(currentPath).name + TMIXP_EXTENSION)
		: path.join(app.getPath('documents'), "New Show" + TMIXP_EXTENSION);

	const result = await dialog.showSaveDialog(getMainWindow(), {
		title: "Save Show",
		defaultPath,
		filters: [{ name: 'TheatreMix Presonus Show', extensions: ['tmixp'] }]
	});

	if (result.canceled || !result.filePath) return false;

	let target = result.filePath;
	if (path.extname(target).toLowerCase() !== TMIXP_EXTENSION) {
		target += TMIXP_EXTENSION;
	}

	return trySave(target);
}

/**
 * Merge an updated .tmix into the open .tmixp
 *
 * The .tmix becomes the source of truth for everything TheatreMix stores (cues,
 * actors, profiles, config...). DCA levels are kept for every cue that still
 * exists (matched by cue number + point). The merge is held in memory and marked
 * unsaved; saving writes it into the .tmixp.
 * @returns {Promise<ShowFile | null>} merged show, or null if canceled
 */
async function mergeTmix() {
	const window = getMainWindow();

	if (currentShow === null || !is_tmixp()) {
		await dialog.showMessageBox(window, {
			type: 'info',
			message: "Open a .tmixp show first",
			detail: "Merging updates a .tmixp show with the latest cues from a TheatreMix .tmix file."
		});
		return null;
	}

	const result = await dialog.showOpenDialog(window, {
		title: "Merge Cues from TheatreMix Show",
		properties: ['openFile'],
		filters: [{ name: 'TheatreMix Show', extensions: ['tmix'] }]
	});

	if (result.canceled || result.filePaths.length === 0) return null;

	const tmixPath = result.filePaths[0];

	let incoming;
	try {
		const db = new DatabaseConnection(tmixPath);
		try {
			incoming = new ShowRepository(db).load();
		} finally {
			db.close();
		}
	} catch (error) {
		console.warn("[showManager]: Failed to read show for merge", error);
		dialog.showErrorBox("Merge Failed", `Could not read ${path.basename(tmixPath)} as a TheatreMix show.\r\n${error.message}`);
		return null;
	}

	// Compare cue lists by cue number + point
	const cue_map = (show) => new Map(show.cues.map((cue) => [dca_level_key(cue.number, cue.point), cue]));
	const before = cue_map(currentShow);
	const after = cue_map(incoming);

	const added = [...after.keys()].filter((key) => !before.has(key));
	const removed = [...before.keys()].filter((key) => !after.has(key));
	const changed = [...after.keys()].filter((key) =>
		before.has(key) && JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key))
	);

	// Keep levels only for cues that still exist
	const kept_levels = {};
	const dropped_levels = [];
	for (const [key, dcas] of Object.entries(currentShow.dcaLevels)) {
		if (after.has(key)) {
			kept_levels[key] = dcas;
		} else {
			dropped_levels.push(key);
		}
	}

	const summary = [
		`${added.length} new cue${added.length === 1 ? "" : "s"}`,
		`${changed.length} changed`,
		`${removed.length} removed`,
	].join(", ");

	const detail = [
		`${summary}.`,
		"Actors, profiles and show settings will also be updated from the .tmix.",
		dropped_levels.length > 0
			? `DCA levels for removed cue${dropped_levels.length === 1 ? "" : "s"} ${dropped_levels.join(", ")} will be dropped.`
			: "All DCA levels will be kept.",
		"Nothing is written until you save."
	].join("\n\n");

	const { response } = await dialog.showMessageBox(window, {
		type: 'question',
		buttons: ['Merge', 'Cancel'],
		defaultId: 0,
		cancelId: 1,
		message: `Merge ${path.basename(tmixPath)} into ${path.basename(currentPath)}?`,
		detail
	});

	if (response !== 0) return null;

	incoming.dcaLevels = kept_levels;
	// StudioLive setup belongs to this app, not TheatreMix: keep it
	incoming.consoleSetup = currentShow.consoleSetup;
	incoming.channelSettings = currentShow.channelSettings;
	currentShow = incoming;
	contentPath = tmixPath;
	// Level history refers to cues that may no longer exist
	clearHistory();
	setDirty(true);

	console.log(`[showManager]: Merged ${tmixPath}: ${summary}, dropped levels for ${dropped_levels.length} cue(s)`);

	return currentShow;
}

/**
 * If there are unsaved changes, ask the user what to do with them
 * @returns {Promise<boolean>} true if it's okay to continue (saved or discarded)
 */
async function confirmDiscardChanges() {
	if (!isShowDirty()) return true;

	const { response } = await dialog.showMessageBox(getMainWindow(), {
		type: 'warning',
		buttons: ['Save', "Don't Save", 'Cancel'],
		defaultId: 0,
		cancelId: 2,
		message: `Save changes to ${currentPath ? path.basename(currentPath) : "the new show"}?`,
		detail: "Your changes will be lost if you don't save them."
	});

	if (response === 2) return false;
	if (response === 0) return saveShow();

	return true;
}

export {
	showEvents,
	loadShow,
	newShow,
	closeShow,
	getShow,
	getShowPath,
	getShowState,
	isShowDirty,
	setDcaLevel,
	setConsoleSetup,
	editShow,
	undoEdit,
	redoEdit,
	saveShow,
	saveShowAs,
	mergeTmix,
	confirmDiscardChanges
};
