// main/menuManager.js
// Application menu, laid out to match TheatreMix (File / Edit / View / Action / Help).
// Items for features this app doesn't have yet are shown disabled, the same way
// TheatreMix greys out items that aren't available.

import { app, Menu, shell, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import { getMainWindow } from './windowManager.js';
import { handle_open_file } from './fileManager.js';
import {
	showEvents, getShow, getShowState, closeShow, newShow, confirmDiscardChanges,
	saveShow, saveShowAs, mergeTmix
} from './showManager.js';
import { show_opened, sync_channel_monitor, probe_user_layer } from './sound.js';
import { openActiveCueWindow, exportNotes, clearMarks } from './cueInfo.js';
import { getSettings, updateSettings, removeRecentFile, viewSettings } from './settings.js';
import { getConsoleButtonReport, getLogAllConsoleMessages, setLogAllConsoleMessages } from './consoleButtons.js';
import { getDebugLogPath } from './debugLog.js';
import { getThemeState, setTheme, openThemesFolder } from './theme.js';

const isMac = process.platform === 'darwin';

const README_URL = 'https://github.com/MaxMessWithTech/TheatreMixClone#readme';

/**
 * What's selected in the cue list (sent by the renderer), for the Edit menu's enabled items
 * kind: the selected cells' column ('cue' | 'text' | 'qlab' | 'dca'), or null for nothing;
 * lineChecks: the Line Checks row is selected; paste / pasteDca: something to paste
 * (pasteDca: DCA cells, so Paste Merge / Swap work)
 */
let editorSelection = {kind: null, lineChecks: false, paste: false, pasteDca: false};

/**
 * Send a menu command to the renderer (cue list actions live there)
 * @param {String} action
 */
const sendMenuAction = (action) => {
	const window = getMainWindow();
	if (window && !window.isDestroyed()) {
		window.webContents.send('menu-action', action);
	}
}

/**
 * Tell the renderer about view preferences (row size, editing lock)
 */
const sendViewSettings = () => {
	const window = getMainWindow();
	if (window && !window.isDestroyed()) {
		window.webContents.send('view-settings', viewSettings());
	}
}

const openShowFile = (filePath) => {
	getMainWindow()?.webContents.send('file-opened', filePath);
}

// #region File handlers

const handle_open_show = async () => {
	const filePath = await handle_open_file();
	if (filePath) {
		openShowFile(filePath);
	}
}

const handle_open_recent = async (filePath) => {
	if (!fs.existsSync(filePath)) {
		await dialog.showMessageBox(getMainWindow(), {
			type: 'warning',
			message: `${path.basename(filePath)} can't be found`,
			detail: `It may have been moved or deleted.\n\n${filePath}`
		});
		removeRecentFile(filePath);
		updateMenu();
		return;
	}

	openShowFile(filePath);
}

const handle_close_show = async () => {
	if (await closeShow()) {
		clearMarks();
		getMainWindow()?.webContents.send('show-updated', null);
	}
}

/**
 * File → New Show: a blank show, then Show Setup to name the channels (like TheatreMix)
 */
const handle_new_show = async () => {
	if (!(await confirmDiscardChanges())) return;
	// The designer carries over from the show that was open
	const show = newShow(getShow()?.config?.designer ?? "");
	clearMarks();
	getMainWindow()?.webContents.send('show-updated', show);
	show_opened();
	// After the window has the new show (with no show before, it would ignore the action)
	setTimeout(() => sendMenuAction('show-setup'), 150);
}

const handle_merge_tmix = async () => {
	const show = await mergeTmix();
	if (show !== null) {
		getMainWindow()?.webContents.send('show-updated', show);
	}
}

// #endregion

// #region Help handlers

/**
 * Help → Console Buttons...: what's mapped, whether the mute groups are safe to use,
 * and what presses have been seen
 */
const handle_console_buttons = async () => {
	const { response } = await dialog.showMessageBox(getMainWindow(), {
		type: 'info',
		message: "Console Buttons",
		detail: getConsoleButtonReport(),
		buttons: ['OK', 'Show Debug Log'],
		defaultId: 0,
	});

	if (response === 1) handle_show_debug_log();
}

/**
 * Help → Read User Layer from Console...: save the console's reply to a User Layer request
 * (to work out whether the app can set the User Layer)
 */
const handle_probe_user_layer = async () => {
	const result = await probe_user_layer();
	if (!result.ok) {
		dialog.showMessageBox(getMainWindow(), {type: 'warning', message: "Couldn't read the User Layer", detail: result.error});
		return;
	}
	const { response } = await dialog.showMessageBox(getMainWindow(), {
		type: 'info',
		message: "User Layer request sent",
		detail: `${result.summary}\n\nEverything it sent is saved in:\n${result.file}\n\nPlease send that file (and the debug log) to Max.`,
		buttons: ['OK', 'Show File'],
		defaultId: 1,
	});
	if (response === 1) shell.showItemInFolder(result.file);
}

const handle_show_debug_log = () => {
	const logPath = getDebugLogPath();

	if (fs.existsSync(logPath)) {
		shell.showItemInFolder(logPath);
	} else {
		dialog.showMessageBox(getMainWindow(), {
			type: 'info',
			message: "Nothing has been logged yet",
			detail: `The debug log will be created at:\n${logPath}`
		});
	}
}

// #endregion

// #region View handlers

const handle_lock_editing = (menuItem) => {
	setLockEditing(menuItem.checked);
}

const handle_row_size = (rowSize) => {
	// A preset replaces any font size set in Settings
	updateSettings({rowSize, fontSize: null});
	sendViewSettings();
}

// #endregion

/**
 * Build the menu template for the current app state
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
const buildTemplate = () => {
	const {hasShow, isTmixp, qLabEnabled, canSave, hasScript} = getShowState();
	const {recentFiles, rowSize, fontSize, lockEditing, showPositions, colorBlindDca, showScript} = getSettings();
	const themeState = getThemeState();

	// Feature not in this app yet
	const notImplemented = {enabled: false};

	// Editing commands: need a show, editing unlocked and a suitable cell selected
	const {kind, lineChecks, paste, pasteDca} = editorSelection;
	const editing = hasShow && !lockEditing;
	const onCue = editing && kind !== null && !lineChecks;
	const cellEdit = onCue && kind !== 'cue';
	const edit = (action, enabled) => ({enabled: !!enabled, click: () => sendMenuAction(action)});

	return [
		// macOS app menu (TheatreMix's About / Quit live here on Mac)
		...(isMac ? [{
			label: app.name,
			submenu: [
				{ role: 'about' },
				{ type: 'separator' },
				{ label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => sendMenuAction('preferences') },
				{ type: 'separator' },
				{ role: 'services' },
				{ type: 'separator' },
				{ role: 'hide' },
				{ role: 'hideOthers' },
				{ role: 'unhide' },
				{ type: 'separator' },
				{ role: 'quit' }
			]
		}] : []),

		{
			label: '&File',
			submenu: [
				{ label: 'New Show', accelerator: 'CmdOrCtrl+N', click: handle_new_show },
				{ label: 'Open Show...', accelerator: 'CmdOrCtrl+O', click: handle_open_show },
				{
					label: 'Open Recent',
					enabled: recentFiles.length > 0,
					submenu: recentFiles.length > 0
						? recentFiles.map((filePath, index) => ({
							label: path.basename(filePath),
							accelerator: `CmdOrCtrl+${index + 1}`,
							click: () => handle_open_recent(filePath)
						}))
						: [{ label: 'No Recent Shows', enabled: false }]
				},
				{ label: 'Close Show', accelerator: 'CmdOrCtrl+W', enabled: hasShow, click: handle_close_show },
				{ type: 'separator' },
				{ label: 'Save Show', accelerator: 'CmdOrCtrl+S', enabled: canSave, click: () => saveShow() },
				{ label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', enabled: hasShow, click: () => saveShowAs() },
				{ label: 'Export Notes...', enabled: hasShow, click: () => exportNotes() },
				{ label: 'Merge Cues from .tmix...', enabled: isTmixp, click: handle_merge_tmix },
				{ type: 'separator' },
				{ label: 'Import Script...', enabled: hasShow, click: () => sendMenuAction('import-script') },
				{ label: 'Export Annotated Script...', enabled: hasScript, click: () => sendMenuAction('export-script') },
				{ type: 'separator' },
				{ label: 'Show Setup', enabled: hasShow, click: () => sendMenuAction('show-setup') },
				{ label: 'Ensemble Setup', enabled: hasShow, click: () => sendMenuAction('ensemble-setup') },
				{ label: 'Position Setup', enabled: hasShow, click: () => sendMenuAction('position-setup') },
				{ label: 'Actor Setup', enabled: hasShow, click: () => sendMenuAction('actor-setup') },
				{ type: 'separator' },
				// Unlike TheatreMix this works without a show, so a console can be tested on its own
				{ label: 'Console Setup', accelerator: 'CmdOrCtrl+K', click: () => sendMenuAction('console-setup') },
				...(isMac ? [] : [
					{ type: 'separator' },
					{ label: 'E&xit', accelerator: 'Ctrl+Q', role: 'quit' }
				]),
			]
		},

		{
			label: '&Edit',
			submenu: [
				// Cut / Copy / Paste act on a text field being typed in, otherwise on the selected
				// cells (handled in the renderer, so they're always enabled for text fields)
				{ label: 'Cut', accelerator: 'CmdOrCtrl+X', click: () => sendMenuAction('cut') },
				{ label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => sendMenuAction('copy') },
				{ label: 'Paste', accelerator: 'CmdOrCtrl+V', click: () => sendMenuAction('paste') },
				{ label: 'Paste Merge', accelerator: 'CmdOrCtrl+Shift+V', ...edit('paste-merge', cellEdit && kind === 'dca' && pasteDca) },
				{ label: 'Paste Swap', accelerator: 'CmdOrCtrl+Alt+V', ...edit('paste-swap', cellEdit && kind === 'dca' && pasteDca) },
				{ label: 'Fill Down', accelerator: 'CmdOrCtrl+D', ...edit('fill-down', cellEdit) },
				{ type: 'separator' },
				// Undo text edits when typing, otherwise show edits (handled in the renderer)
				{ label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendMenuAction('undo') },
				{ label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendMenuAction('redo') },
				{ type: 'separator' },
				{ label: 'Insert Cue', accelerator: 'CmdOrCtrl+M', ...edit('insert-cue', editing && kind !== null) },
				{ label: 'Clone Cue', accelerator: 'CmdOrCtrl+Alt+C', ...edit('clone-cue', onCue) },
				{ label: 'Clone Cue to end', accelerator: 'CmdOrCtrl+Alt+Shift+C', ...edit('clone-cue-end', onCue) },
				// TheatreMix uses ⌘⌫ here; the cue list handles it, so it keeps working in text fields
				{ label: 'Delete Cue', ...edit('delete-cue', onCue) },
				{ type: 'separator' },
				{ label: 'Skip Cue', accelerator: 'CmdOrCtrl+Alt+K', ...edit('skip-cue', onCue) },
				{ label: 'Renumber Cues...', ...edit('renumber', onCue) },
				{ type: 'separator' },
				{ label: 'Assign...', accelerator: 'CmdOrCtrl+E', ...edit('assign', onCue && kind === 'dca') },
				{ label: 'Clear Assignment', ...edit('clear-assignment', onCue && kind === 'dca') },
			]
		},

		{
			label: '&View',
			submenu: [
				{ label: 'Lock Editing', type: 'checkbox', accelerator: 'CmdOrCtrl+L', checked: lockEditing, enabled: hasShow, click: handle_lock_editing },
				{ type: 'separator' },
				{ label: 'FX', accelerator: 'CmdOrCtrl+F', ...notImplemented },
				{ label: 'Positions', type: 'checkbox', accelerator: 'CmdOrCtrl+T', checked: showPositions, enabled: hasShow,
					click: (item) => { updateSettings({showPositions: item.checked}); sendViewSettings(); } },
				{ label: 'Color-Blind DCA Colors', type: 'checkbox', checked: colorBlindDca,
					click: (item) => { updateSettings({colorBlindDca: item.checked}); sendViewSettings(); sync_channel_monitor(); } },
				{
					label: 'Theme',
					submenu: [
						...themeState.themes.map((theme) => ({
							label: theme.name,
							type: 'radio',
							checked: themeState.id === theme.id,
							click: () => { setTheme(theme.id); updateMenu(); },
						})),
						{ type: 'separator' },
						{ label: 'Open Themes Folder', click: () => openThemesFolder() },
					]
				},
				{
					label: 'Row Size',
					submenu: ['small', 'medium', 'large'].map((size) => ({
						label: size[0].toUpperCase() + size.slice(1),
						type: 'radio',
						checked: fontSize === null && rowSize === size,
						enabled: hasShow,
						click: () => handle_row_size(size)
					}))
				},
				{ type: 'separator' },
				{ label: 'Script', type: 'checkbox', accelerator: 'CmdOrCtrl+P', checked: showScript, enabled: hasShow,
					click: (item) => { updateSettings({showScript: item.checked}); sendViewSettings(); } },
				{ label: 'Channel Utilisation', accelerator: 'CmdOrCtrl+U', enabled: hasShow, click: () => sendMenuAction('channel-utilisation') },
				{ label: 'Active Cue Info', accelerator: 'CmdOrCtrl+I', click: () => openActiveCueWindow() },
				...(isMac ? [] : [{ label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => sendMenuAction('preferences') }]),

				// Developer tools while running from source
				...(app.isPackaged ? [] : [
					{ type: 'separator' },
					{
						label: 'Developer',
						submenu: [
							{ role: 'reload', accelerator: '' },
							{ role: 'forceReload', accelerator: '' },
							{ role: 'toggleDevTools' },
						]
					}
				]),
			]
		},

		{
			label: '&Action',
			submenu: [
				{ label: 'Go', accelerator: 'CmdOrCtrl+G', enabled: hasShow, click: () => sendMenuAction('go') },
				{ label: 'Back', accelerator: 'CmdOrCtrl+B', enabled: hasShow, click: () => sendMenuAction('back') },
				{ label: 'Jump...', accelerator: 'CmdOrCtrl+J', enabled: hasShow, click: () => sendMenuAction('jump') },
				{ label: 'Jump to Selected Cue', accelerator: 'CmdOrCtrl+Alt+J', enabled: hasShow, click: () => sendMenuAction('jump-selected') },
				{ type: 'separator' },
				{ label: 'Store Channel Settings from Console', accelerator: 'CmdOrCtrl+Alt+S', enabled: hasShow, click: () => sendMenuAction('store-settings') },
				{ type: 'separator' },
				{ label: 'Mark Selected Cue...', accelerator: 'CmdOrCtrl+R', enabled: hasShow, click: () => sendMenuAction('mark-selected') },
				{ label: 'Mark Current Cue...', accelerator: 'CmdOrCtrl+Shift+R', enabled: hasShow, click: () => sendMenuAction('mark-current') },
				{ type: 'separator' },
				// Starts the selected cue's QLab cue without firing the cue (works without a console)
				{ label: 'Test QLab Recall', accelerator: 'CmdOrCtrl+Alt+T', enabled: hasShow && qLabEnabled, click: () => sendMenuAction('test-qlab') },
			]
		},

		{
			label: '&Help',
			role: 'help',
			submenu: [
				{ label: 'Quick Start', click: () => shell.openExternal(README_URL) },
				{ label: 'Feature Guide', click: () => shell.openExternal(`${README_URL.replace('#readme', '')}#editing-shows`) },
				{ type: 'separator' },
				// Troubleshooting the console's Go / Back buttons
				{ label: 'Console Buttons...', click: handle_console_buttons },
				{
					label: 'Log All Console Messages',
					type: 'checkbox',
					checked: getLogAllConsoleMessages(),
					click: (menuItem) => setLogAllConsoleMessages(menuItem.checked)
				},
				{ label: 'Show Debug Log', click: handle_show_debug_log },
				{ label: 'Read User Layer from Console...', click: handle_probe_user_layer },
				...(isMac ? [] : [
					{ type: 'separator' },
					{ role: 'about' },
				]),
				{ type: 'separator' },
				{ label: 'Learn More', click: () => shell.openExternal('https://maxdangermiller.com') },
			]
		},
	];
}

/**
 * Rebuild the menu (enabled states, recent shows, checkmarks)
 */
const updateMenu = () => {
	Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate()));
}

/**
 * Build the menu and keep it in sync with the show
 */
const initMenu = () => {
	updateMenu();
	showEvents.on('changed', updateMenu);
}

/**
 * Toggle View → Lock Editing (from the menu or the toolbar)
 * @param {boolean} locked 
 */
const setLockEditing = (locked) => {
	updateSettings({lockEditing: !!locked});
	sendViewSettings();
	updateMenu();
}

/**
 * The cue list's selection changed (enables the Edit menu's items)
 * @param {{kind: String | null, lineChecks: boolean, paste: boolean, pasteDca: boolean}} selection
 */
const setEditorSelection = (selection) => {
	const next = {kind: null, lineChecks: false, paste: false, pasteDca: false, ...selection};
	if (JSON.stringify(next) === JSON.stringify(editorSelection)) return;
	editorSelection = next;
	updateMenu();
}

export { initMenu, updateMenu, sendViewSettings, sendMenuAction, setLockEditing, setEditorSelection, handle_new_show as handleNewShow };
