// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('presonus', {
  	discover: (timeout) => 
		ipcRenderer.invoke('presonus:discover', {timeout}),

  	onDeviceFound: (callback) =>
		ipcRenderer.on('presonus:device-found', (_event, device) => callback(device)),
	removeDeviceFoundListener: () =>
		ipcRenderer.removeAllListeners('presonus:device-found'),

	// name: console name from discovery, shown in the status tooltip; serial: remembered
	// so the app can find this console again on launch (auto-connect)
  	connect: (host, port, name, serial) =>
	  	ipcRenderer.invoke('presonus:connect', { host, port, name, serial }),

	// {state: 'disconnected' | 'connecting' | 'connected', host?, name?, message?}
	getStatus: () =>
		ipcRenderer.invoke('presonus:get_status'),
	onStatus: (callback) => {
		const listener = (_event, status) => callback(status);
		ipcRenderer.on('console-status', listener);
		return () => ipcRenderer.removeListener('console-status', listener);
	},

  	disconnect: () =>
	  	ipcRenderer.invoke('presonus:disconnect'),

  	set_dca: (dca) =>
	  	ipcRenderer.invoke('presonus:set_dca', { dca }),

	// back: fired by the Back button (QLab recall may be suppressed)
  	write_cue: (cue_object, {back = false} = {}) =>
	  	ipcRenderer.invoke('presonus:write_cue', {cue_object, back}),

  	fire_sound_check: () =>
	  	ipcRenderer.invoke('presonus:fire_sound_check', {}),

	// Store from console: {ok: true, settings: {section: {param: value}}} or {ok: false, error}
	captureSettings: (channel, sections) => ipcRenderer.invoke('presonus:capture_settings', {channel, sections}),
	// A line's settings on the console now (nothing stored): {ok, settings} or {ok: false, error}
	readSettings: (channel) => ipcRenderer.invoke('presonus:read_settings', channel),
	// Show channels' faders on the console now: {connected, cue: "1.5" | null, lines: {ch: {line, db, target}}}
	getLineLevels: () => ipcRenderer.invoke('presonus:get_line_levels'),

	// Backup channels: {pairs: [{main, backup, label, switched, spare}], spare, spareFor}
	getBackups: () => ipcRenderer.invoke('presonus:get_backups'),
	toggleBackup: (main) => ipcRenderer.invoke('presonus:toggle_backup', main),
	assignSpare: (main) => ipcRenderer.invoke('presonus:assign_spare', main),
	onBackups: (callback) => subscribe('backup-status', callback),
});

contextBridge.exposeInMainWorld('showApi', {
	loadShow: path =>
		ipcRenderer.invoke('show:load', path),

	getShow: () =>
		ipcRenderer.invoke('show:get'),

	// Main replaced the show (e.g. after merging a .tmix)
	onShowUpdated: (callback) =>
		ipcRenderer.on('show-updated', (_event, show) => callback(show)),
	removeShowUpdatedListener: () =>
		ipcRenderer.removeAllListeners('show-updated'),

	// level in dB, or null to go back to the default
	setDcaLevel: (number, point, dca, level) =>
		ipcRenderer.invoke('show:set_dca_level', {number, point, dca, level}),

	// File → Save Show; returns true if saved
	save: () =>
		ipcRenderer.invoke('show:save'),

	// Is there anything to save? (unsaved changes, or a .tmix not yet saved as a .tmixp)
	canSave: () =>
		ipcRenderer.invoke('show:can_save'),
	onCanSave: (callback) => subscribe('show-can-save', callback),

	// {canUndo, canRedo}, for the toolbar's Undo / Redo
	getEditState: () => ipcRenderer.invoke('show:edit_state'),
	onEditState: (callback) => subscribe('show-edit-state', callback),

	// Apply edits (see utils/show_edits.js) as one undo step:
	// {ok: true, show, results} or {ok: false, error}
	edit: (ops) =>
		ipcRenderer.invoke('show:edit', ops),

	// Return the show, or null if there was nothing to undo / redo
	undo: () =>
		ipcRenderer.invoke('show:undo'),
	redo: () =>
		ipcRenderer.invoke('show:redo'),
});

/**
 * Subscribe to an IPC channel, returning a function that removes just this listener
 * @param {String} channel 
 * @param {Function} callback 
 */
const subscribe = (channel, callback) => {
	const listener = (_event, value) => callback(value);
	ipcRenderer.on(channel, listener);
	return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('consoleSetupApi', {
	// {hasShow, connected, source, map: {group: action}, actions, groups}
	get: () => ipcRenderer.invoke('console-setup:get'),

	// groupToAction: {muteGroup: actionId}; saved in the show (mark unsaved)
	setButtonMap: (groupToAction) => ipcRenderer.invoke('console-setup:set_button_map', groupToAction),

	// {group, on, pressed, action, fired} whenever a mute group changes on the console
	onButtonActivity: (callback) => subscribe('console-buttons-activity', callback),

	// Mute group names / channels or the show's map changed
	onChanged: (callback) => subscribe('console-buttons-changed', callback),

	// Console Setup preferences: {levelsFollowPeople, restoreOnBack, autoConnect}
	getRecall: () => ipcRenderer.invoke('app:get_recall_settings'),
	setRecall: (changes) => ipcRenderer.invoke('app:set_recall_settings', changes),
});

contextBridge.exposeInMainWorld('cueInfoApi', {
	// {current: {key, number, name, colour}, next: {...} | null, marked}
	get: () => ipcRenderer.invoke('cue-info:get'),
	onChange: (callback) => subscribe('active-cue', callback),

	// Mark a cue (key, or null for Line Checks) with a note; returns every mark
	mark: (key, note) => ipcRenderer.invoke('marks:mark', {key, note}),
	getMarks: () => ipcRenderer.invoke('marks:get'),
});

contextBridge.exposeInMainWorld('editorApi', {
	// {kind, lineChecks, paste, pasteDca}: what's selected in the cue list (Edit menu items)
	setSelection: (selection) => ipcRenderer.invoke('editor:set_selection', selection),

	// Cue highlight color menu at the mouse: resolves to the color index, or null
	colorMenu: (current) => ipcRenderer.invoke('editor:color_menu', current),
});

contextBridge.exposeInMainWorld('qlabApi', {
	// Start a QLab cue now (Test QLab Recall); returns {ok, error?}
	recall: (cueNumber) => ipcRenderer.invoke('qlab:recall', cueNumber),

	// {state: 'off' | 'connecting' | 'connected', workspace?, message?}
	getStatus: () => ipcRenderer.invoke('qlab:get_status'),
	onStatus: (callback) => subscribe('qlab-status', callback),
});

// Theme engine: {id, colors: {name: css color}, themes: [{id, name, custom}]}
contextBridge.exposeInMainWorld('themeApi', {
	get: () => ipcRenderer.invoke('theme:get'),
	set: (id) => ipcRenderer.invoke('theme:set', id),
	openFolder: () => ipcRenderer.invoke('theme:open_folder'),
	onChange: (callback) => subscribe('theme-changed', callback),
});

contextBridge.exposeInMainWorld('menuApi', {
	// Menu commands handled in the renderer: go, back, jump, jump-selected, undo, redo, console-setup
	onMenuAction: (callback) => subscribe('menu-action', callback),

	// Run a menu command (used by the toolbar): go, back, undo, redo...
	trigger: (action) => ipcRenderer.invoke('menu:trigger', action),

	// {rowSize: 'small' | 'medium' | 'large', lockEditing: boolean}
	getViewSettings: () => ipcRenderer.invoke('app:get_view_settings'),
	setLockEditing: (locked) => ipcRenderer.invoke('app:set_lock_editing', locked),
	setShowPositions: (on) => ipcRenderer.invoke('app:set_show_positions', on),
	// {fontSize?: Number | null, columnWidths?: {col: px}}
	updateViewSettings: (changes) => ipcRenderer.invoke('app:update_view_settings', changes),
	onViewSettings: (callback) => subscribe('view-settings', callback),
});

contextBridge.exposeInMainWorld('electronAPI', {
	openFile: () => ipcRenderer.invoke('electronAPI:openFile'),

  	onOpenFile: (callback) => ipcRenderer.on('file-opened', (event, filePath) => callback(filePath)),
	removeOpenFileListener: () => ipcRenderer.removeAllListeners('file-opened'),
	
	openErrorDialog: msg => ipcRenderer.invoke('presonus:openErrorDialog', msg),

	onMainLog: (callback) => ipcRenderer.on('main-log', (_event, value) => callback(value)),
	removeMainLogListener: () => ipcRenderer.removeAllListeners('main-log'),


});