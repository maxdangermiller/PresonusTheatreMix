import React, { useEffect, useState, useRef, useMemo } from 'react'

import { cue_sorter } from '../utils/sorters.js';
import { get_DCA_label } from './utils/cue_utils.js';
import { get_dca_level, format_dca_level } from '../utils/dca_levels.js';
import {
	cue_key, dca_field, read_dca, parse_channels, parse_map, resolve_dca_text, ensemble_channels,
	MAX_DCAS, default_profile, profile_flags, with_profile_flags, SETTING_SECTIONS, show_dcas,
} from '../utils/show_edits.js';
import AssignDialog from './AssignDialog.jsx';
import RenumberDialog from './RenumberDialog.jsx';
import ShowSetupDialog from './ShowSetupDialog.jsx';
import EnsembleSetupDialog from './EnsembleSetupDialog.jsx';
import PositionSetupDialog from './PositionSetupDialog.jsx';
import ActorSetupDialog from './ActorSetupDialog.jsx';
import ChannelUtilisation from './ChannelUtilisation.jsx';
import MarkDialog from './MarkDialog.jsx';
import BackupTray from './BackupTray.jsx';

// File → ... Setup windows
const SETUP_DIALOGS = {
	'show-setup': ShowSetupDialog,
	'ensemble-setup': EnsembleSetupDialog,
	'position-setup': PositionSetupDialog,
	'actor-setup': ActorSetupDialog,
};

import {
	HEADER_COLOR, ACTIVE_CUE_ACCENT, ACTIVE_CUE_TINT, BORDER_COLOR,
	TEXT_COLOR, SELECTED_COLOR, DCA_STATE_COLORS,
	get_cue_color
} from './utils/colors.jsx';
import { next_cue, dca_next_state, color_blind_state } from '../utils/dca_state.js';
import JumpDialog from './JumpDialog.jsx';
import { format_cue_number, parse_cue_number } from '../utils/cue_number.js';


// Fills the space under the toolbar, with an even 10px margin on every side
const CONTAINER_STYLE = {
	flex: 1,
	minHeight: 0,
	display: "flex",
	padding: "10px",
	position: "relative",
}

// The bordered box the cue list scrolls inside, so both scrollbars sit within the border
const SCROLL_BOX_STYLE = {
	flex: 1,
	minWidth: 0,
	overflow: 'auto',
	backgroundColor: "#000",
	border: '1px solid ' + BORDER_COLOR,
}

// Columns: cue number (fixed), text (wider), DCAs share the rest equally.
// Below the minimum width (DCAs ~96px each) the table scrolls sideways inside the box.
const CUE_COLUMN_WIDTH = 72;
const TEXT_COLUMN_WIDTH = '20%';
// The table's minimum width: the cue / text / QLab columns plus ~96px per DCA
const TABLE_FIXED_WIDTH = 282;
const DCA_MIN_WIDTH = 96;

const TABLE_STYLE = {
	width: '100%',
	tableLayout: 'fixed',
	borderCollapse: 'collapse',
	textAlign: 'left',
	color: TEXT_COLOR,
	fontFamily: 'Arial',
}

// Header stays visible while scrolling (a shadow stands in for the bottom border,
// which border-collapse doesn't keep on sticky cells)
const HEADER_ITEM_STYLE = {
	position: 'sticky',
	top: 0,
	zIndex: 1,
	backgroundColor: HEADER_COLOR,
	padding: '6px',
	border: '1px solid ' + BORDER_COLOR,
	boxShadow: `inset 0 -3px 0 ${BORDER_COLOR}`,
	textAlign: 'center',
	fontSize: 15,
	overflow: 'hidden',
	textOverflow: 'ellipsis',
	whiteSpace: 'nowrap'
}

const ROW_ITEM_STYLE = {
	padding: '4px 6px',
	border: '1px solid ' + BORDER_COLOR,
	fontSize: 22,
	overflow: 'hidden',
	textOverflow: 'ellipsis',
	whiteSpace: 'nowrap',
	userSelect: 'none',
}

const CUE_ITEM_STYLE = {
	...ROW_ITEM_STYLE,
	textAlign: 'center'
}

const LINE_CHECKS_ITEM_STYLE = {
	...ROW_ITEM_STYLE,
	fontStyle: 'italic'
}

const DCA_ITEM_STYLE = {
	...ROW_ITEM_STYLE,
	textAlign: 'center'
}

const DCA_LEVEL_STYLE = {
	fontSize: 13,
	opacity: 0.75
}

// Like TheatreMix: a cue with DCA assignments shows them on black (ensembles on gray);
// a cue with none keeps its color across the row
const ASSIGNED_DCA_BACKGROUND = "#0b0b0b";
const ENSEMBLE_DCA_BACKGROUND = "#454545";
const PLACEHOLDER_TEXT_COLOR = "#8a8a8a";   // a DCA label with no channels
const SKIPPED_TEXT_COLOR = "#c08cf0";       // skipped cue (TheatreMix: purple italic, struck through)

// Typing into a cell (TheatreMix edits in a dark red box)
const CELL_EDITOR_STYLE = {
	width: '100%',
	boxSizing: 'border-box',
	backgroundColor: '#6a0000',
	color: TEXT_COLOR,
	border: 'none',
	outline: '2px solid #b33',
	font: 'inherit',
	padding: 0,
	textAlign: 'inherit',
}

const TOAST_STYLE = {
	position: 'absolute',
	left: '50%',
	bottom: 24,
	transform: 'translateX(-50%)',
	backgroundColor: '#5a1f1f',
	color: TEXT_COLOR,
	border: '1px solid #a44',
	borderRadius: 6,
	padding: '8px 14px',
	fontFamily: 'Arial',
	fontSize: 15,
	zIndex: 50,
	pointerEvents: 'none',
}

const TOAST_INFO_STYLE = {backgroundColor: '#1f3b5a', border: '1px solid #4a7fb5'};

// A marked cue (Action → Mark ... Cue): a red dot after its number
const MARK_STYLE = {color: '#ff6b6b', fontSize: '0.6em', marginLeft: 4, verticalAlign: 'super'};

// QLab cue number column (shown when the show recalls QLab cues)
const QLAB_COLUMN_WIDTH = 70;

// View → Row Size
const ROW_FONT_SIZES = {small: 16, medium: 22, large: 30};

/** Column ids: 'cue', 'text', 'qlab', 'dca1'..'dca8' */
const dca_of = (col) => col?.startsWith('dca') ? Number(col.slice(3)) : null;
const col_kind = (col) => dca_of(col) !== null ? 'dca' : col;

/**
 * A cue row's style. The active cue keeps its own color (so its color coding still shows) and
 * is marked with a green tint and bold text; its cue number cell gets a green bar (active_cell).
 * @param {String} color the cue's color
 * @param {boolean} active
 */
const row_style = (color, active) => ({
	backgroundColor: color,
	...(active ? {backgroundImage: `linear-gradient(${ACTIVE_CUE_TINT}, ${ACTIVE_CUE_TINT})`, fontWeight: 'bold'} : {}),
});

// The active cue's number cell: a bar down its left edge
const active_cell = (style, active) => active
	? {...style, boxShadow: `inset 9px 0 0 ${ACTIVE_CUE_ACCENT}`}
	: style;

/**
 * Is the user typing in a text field? (Undo / Redo / Space should go to the field)
 * @param {Element} el
 * @returns {boolean}
 */
const is_text_field = (el) => {
	if (!el) return false;
	if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
	return el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(el.type);
}

/**
 * @typedef {Object} EditorProps
 * @property {Object} showData - all the data of a show database
 * @property {function} setShowData - function that sets the show data
 */

/**
 * The cue list: fires cues, and (with editing unlocked) edits them like TheatreMix:
 * select cells, type into them, cut / copy / paste, insert / clone / delete cues, assign DCAs
 * @param {EditorProps} props
 */
const Editor = ({showData, setShowData}) => {

	const rowRefs = useRef({});

	// The active cue: its row index (-1 = Line Checks) and key, so it stays put when cues are
	// added, removed or renumbered around it
	const [cue_index, set_index] = useState(-1);
	const activeKeyRef = useRef(null);

	/** Selected cells: anchor and focus corners, {row, col} (row -1 = Line Checks) */
	const [selection, set_selection] = useState(null);

	/** A cell being typed into: {row, col, text} */
	const [cell_edit, set_cell_edit] = useState(null);

	/**
	 * Cut / copied cells: {kind, cells: [[value]], keys: [cue keys], cols: [col ids], cut}
	 * DCA values are read_dca() objects; text / qlab values are strings
	 */
	const [clipboard, set_clipboard] = useState(null);

	/** @type {[{key: String, dca: Number} | null, Function]} DCA open in the Assign dialog */
	const [assign_dialog, set_assign_dialog] = useState(null);
	const [renumber_dialog, set_renumber_dialog] = useState(null);
	const [jump_dialog_open, set_jump_dialog_open] = useState(false);
	/** Open Setup window: a SETUP_DIALOGS key */
	const [setup_dialog, set_setup_dialog] = useState(null);
	const [utilisation_open, set_utilisation_open] = useState(false);
	/** Cue being marked: {key (null = Line Checks), title, current (closes when the next cue fires)} */
	const [mark_dialog, set_mark_dialog] = useState(null);
	/** Marked cues this session: {key: note} */
	const [marks, set_marks] = useState({});

	// A short message for edits that can't be done (e.g. a cue number that's taken)
	const [toast, set_toast] = useState(null);
	const toastTimer = useRef(null);

	// View menu preferences
	const [view, set_view] = useState({rowSize: 'medium', lockEditing: false, showPositions: false, colorBlindDca: false});

	const dialog_open = assign_dialog !== null || renumber_dialog !== null || jump_dialog_open || setup_dialog !== null
		|| utilisation_open || mark_dialog !== null;
	const can_edit = showData !== null && !view.lockEditing;

	// TheatreMix: Show Setup → QLab → "Recall QLab cues" adds a QLab column
	const show_qlab = showData?.config?.qLabCues === "1";
	// The DCAs the show controls (Show Setup → DCAs to control; up to 24 with "Use all 24 DCAs")
	const DCA_NUMBERS = useMemo(() => show_dcas(showData), [showData]);
	const columns = useMemo(() => ['cue', 'text', ...(show_qlab ? ['qlab'] : []), ...DCA_NUMBERS.map((d) => `dca${d}`)], [show_qlab, DCA_NUMBERS]);

	const cues = useMemo(() => showData?.cues ? [...showData.cues].sort(cue_sorter) : [], [showData]);

	// Latest values for async code
	const showRef = useRef(showData);
	showRef.current = showData;

	/**
	 * Apply the current row size to a cell style
	 * @param {Object} style
	 */
	const sized = (style) => ({...style, fontSize: ROW_FONT_SIZES[view.rowSize] ?? ROW_FONT_SIZES.medium});

	/** A short message over the cue list: kind 'error' (the default, an edit that couldn't be done) or 'info' */
	const flash = (message, kind = 'error') => {
		set_toast({message, kind});
		clearTimeout(toastTimer.current);
		toastTimer.current = setTimeout(() => set_toast(null), 3500);
	}

	// #region Firing cues

	/**
	 * Fire Cue
	 * @param {Object} cue
	 * @param {Object} show
	 * @param {{back?: boolean}} options back: fired by the Back button
	 */
	const fireCueObject = async (cue, show, {back = false} = {}) => {
		const modified_cue = {...cue};
		for (let d = 1; d <= MAX_DCAS; d++) modified_cue[dca_field(d, 'Label')] = get_DCA_label(show, cue, d);
		console.log("[Editor] Firing cue: ", modified_cue)

		await window.presonus.write_cue(modified_cue, {back});
	}

	/**
	 * Fire Sound Check Cue
	 */
	const fireSoundCheck = async () => {
		console.log("[Editor] Firing SOUND CHECK CUE!");

		await window.presonus.fire_sound_check();
	}

	/**
	 * Go To Row: make it the active cue and fire it
	 * @param {Integer} row_index
	 * @param {{back?: boolean}} options back: fired by the Back button
	 */
	const goToRow = (row_index, options = {}) => {
		if (row_index < -1 || row_index >= cues.length) return;

		set_index(row_index);
		activeKeyRef.current = row_index === -1 ? null : cue_key(cues[row_index]);

		if (row_index === -1) fireSoundCheck(); else fireCueObject(cues[row_index], showData, options);

		rowRefs.current[row_index + 1]?.scrollIntoView({behavior: 'smooth', block: 'center'});
	};

	/**
	 * The next cue Go / Back fires from a row: skipped cues are passed over (Line Checks never is)
	 * @param {Number} from row
	 * @param {1 | -1} step
	 */
	const nextPlayable = (from, step) => {
		let row = from + step;
		while (row >= 0 && row < cues.length && Number(cues[row].skip)) row += step;
		return row;
	}

	// #endregion

	// #region Selection

	const rowCount = cues.length;
	const colIndex = (col) => columns.indexOf(col);

	/** Selected rectangle: {top, bottom, left, right} (row and column indexes) */
	const rect = selection ? {
		top: Math.min(selection.anchor.row, selection.focus.row),
		bottom: Math.max(selection.anchor.row, selection.focus.row),
		left: Math.min(colIndex(selection.anchor.col), colIndex(selection.focus.col)),
		right: Math.max(colIndex(selection.anchor.col), colIndex(selection.focus.col)),
	} : null;

	const isSelected = (row, col) => rect !== null && row >= rect.top && row <= rect.bottom
		&& colIndex(col) >= rect.left && colIndex(col) <= rect.right;

	/** The selection's single column kind ('cue' | 'text' | 'qlab' | 'dca'), or 'mixed' */
	const selectionKind = () => {
		if (!rect) return null;
		const kinds = new Set(columns.slice(rect.left, rect.right + 1).map(col_kind));
		return kinds.size === 1 ? [...kinds][0] : 'mixed';
	}

	/** Cue rows in the selection (Line Checks left out) */
	const selectedCueRows = () => {
		if (!rect) return [];
		const rows = [];
		for (let r = Math.max(0, rect.top); r <= rect.bottom; r++) rows.push(r);
		return rows;
	}

	const selectCell = (row, col, extend = false) => {
		set_selection((prev) => ({anchor: extend && prev ? prev.anchor : {row, col}, focus: {row, col}}));
		rowRefs.current[row + 1]?.scrollIntoView({block: 'nearest'});
	}

	/** Select a cue by key (after it's been added or renumbered) */
	const selectKey = (show, key, col) => {
		const sorted = [...show.cues].sort(cue_sorter);
		const row = sorted.findIndex((c) => cue_key(c) === key);
		if (row >= 0) {
			set_selection({anchor: {row, col}, focus: {row, col}});
			setTimeout(() => rowRefs.current[row + 1]?.scrollIntoView({block: 'nearest'}), 0);
		}
	}

	// The Edit menu enables items for what's selected
	useEffect(() => {
		const kind = selectionKind();
		window.editorApi?.setSelection({
			kind: kind === 'mixed' ? 'text' : kind,
			lineChecks: rect !== null && rect.top === -1 && rect.bottom === -1,
			paste: clipboard !== null,
			pasteDca: clipboard?.kind === 'dca',
		});
	}, [selection, clipboard, columns]);

	// #endregion

	// #region Editing

	/**
	 * Apply edits (one undo step). If the active cue changed, it's re-sent to the console so
	 * it matches straight away (like TheatreMix's live editing).
	 * @param {Object[]} ops
	 * @param {{setup?: boolean}} options setup: from a Setup window, which works with editing locked too
	 * @returns {Promise<{show: Object, results: Object[]} | null>} null if an edit failed
	 */
	const runEdit = async (ops, {setup = false} = {}) => {
		if (showData === null || (!can_edit && !setup) || !ops.length) return null;
		const result = await window.showApi.edit(ops);
		if (!result.ok) {
			flash(result.error);
			return null;
		}
		setShowData(result.show);

		const active = activeKeyRef.current;
		if (active && ops.some((op) => op.cue === active || op.op === 'renumber' || op.op === 'delete_cues')) {
			const cue = result.show.cues.find((c) => cue_key(c) === active);
			if (cue) fireCueObject(cue, result.show);
		}
		return result;
	}

	const cellText = (cue, col) => col === 'text' ? (cue.name ?? "")
		: col === 'qlab' ? (cue.qLabCue ?? "")
		: col === 'cue' ? format_cue_number(cue.number, cue.point)
		: (cue[dca_field(dca_of(col), 'Label')] ?? "");

	/** Start typing into a cell (text: what to start with; undefined keeps its value) */
	const startEdit = (row, col, text) => {
		if (!can_edit || row < 0) return;
		const cue = cues[row];
		set_cell_edit({row, col, text: text ?? (col_kind(col) === 'dca' ? get_DCA_label(showData, cue, dca_of(col)).replace(/^-$/, "") : cellText(cue, col))});
	}

	/**
	 * Finish typing into a cell
	 * @param {{force?: boolean}} options force: ⌘Enter in a DCA cell replaces instead of merging an ensemble
	 */
	const commitEdit = async ({force = false} = {}) => {
		const edit = cell_edit;
		set_cell_edit(null);
		if (!edit) return;
		const cue = cues[edit.row];
		if (!cue) return;
		const key = cue_key(cue);
		const text = edit.text.trim();

		if (edit.col === 'cue') {
			if (text === format_cue_number(cue.number, cue.point)) return;
			const parsed = parse_cue_number(text);
			if (!parsed) { flash("Enter a cue number like 12 or 12.5"); return; }
			const result = await runEdit([{op: 'set_cue_number', cue: key, ...parsed}]);
			if (result) {
				if (activeKeyRef.current === key) activeKeyRef.current = result.results[0].key;
				selectKey(result.show, result.results[0].key, 'cue');
			}
		} else if (edit.col === 'text' || edit.col === 'qlab') {
			const field = edit.col === 'text' ? 'name' : 'qLabCue';
			if ((cue[field] ?? "") !== edit.text) await runEdit([{op: 'set_cue_field', cue: key, field, value: edit.col === 'text' ? edit.text : text}]);
		} else {
			await typeIntoDca(cue, dca_of(edit.col), text, force);
		}
	}

	/**
	 * Typing into a DCA cell: an ensemble name merges it in (⌘Enter replaces), a character /
	 * profile name or channel numbers assign those channels, nothing clears the DCA
	 */
	const typeIntoDca = async (cue, dca, text, force) => {
		const key = cue_key(cue);
		const current = read_dca(showData, cue, dca);
		if (!text) {
			if (current.channels.length || current.label) await runEdit([{op: 'clear_dca', cue: key, dca}]);
			return;
		}
		if (text === get_DCA_label(showData, cue, dca)) return;

		const match = resolve_dca_text(showData, text);
		if (!match) {
			flash(`No channel, profile or ensemble called "${text}"`);
			return;
		}
		if (match.kind === 'ensemble') {
			const {channels, profiles} = ensemble_channels(match.ensemble);
			const merge = !force && current.channels.length > 0;
			const list = merge ? [...current.channels, ...channels.filter((ch) => !current.channels.includes(ch))] : channels;
			await runEdit([{
				op: 'set_dca', cue: key, dca, channels: list,
				label: merge ? (current.label ?? match.ensemble.name) : match.ensemble.name,
				positions: merge ? current.positions : {}, profiles: {...(merge ? current.profiles : {}), ...profiles},
				levels: merge ? current.levels : {},
			}]);
		} else {
			await runEdit([{op: 'set_dca', cue: key, dca, channels: match.channels, profiles: match.profiles, label: null}]);
		}
	}

	/** Read the selected cells into a clipboard */
	const copySelection = (cut) => {
		const kind = selectionKind();
		const rows = selectedCueRows();
		if (!rows.length || kind === 'cue' || kind === 'mixed') return false;
		const cols = columns.slice(rect.left, rect.right + 1);
		set_clipboard({
			kind,
			cut,
			keys: rows.map((r) => cue_key(cues[r])),
			cols,
			cells: rows.map((r) => cols.map((col) => kind === 'dca' ? read_dca(showData, cues[r], dca_of(col)) : cellText(cues[r], col))),
		});
		return true;
	}

	/** Edit ops that put a clipboard value into a cell */
	const setCellOps = (cue, col, value, {merge = false} = {}) => {
		const key = cue_key(cue);
		if (col_kind(col) === 'dca') {
			const dca = dca_of(col);
			if (merge) {
				const current = read_dca(showData, cue, dca);
				return [{
					op: 'set_dca', cue: key, dca,
					channels: [...current.channels, ...value.channels.filter((ch) => !current.channels.includes(ch))],
					label: current.label ?? (current.channels.length ? null : value.label),
					positions: {...value.positions, ...current.positions},
					profiles: {...value.profiles, ...current.profiles},
					levels: {...value.levels, ...current.levels},
				}];
			}
			return [{op: 'set_dca', cue: key, dca, ...value}];
		}
		return [{op: 'set_cue_field', cue: key, field: col === 'text' ? 'name' : 'qLabCue', value}];
	}

	const clearCellOps = (key, col) => col_kind(col) === 'dca'
		? [{op: 'clear_dca', cue: key, dca: dca_of(col)}]
		: [{op: 'set_cue_field', cue: key, field: col === 'text' ? 'name' : 'qLabCue', value: ""}];

	/**
	 * Paste at the selection. A single copied cell fills every selected cell; otherwise the
	 * copied block goes in from the top-left selected cell. Cells only paste into the same kind
	 * of column (DCA into any DCA). merge: Paste Merge adds DCA channels instead of replacing.
	 */
	const paste = async ({merge = false} = {}) => {
		if (!clipboard || !rect) return;
		const targets = [];
		const single = clipboard.cells.length === 1 && clipboard.cells[0].length === 1;
		const rows = selectedCueRows();
		if (single) {
			for (const r of rows) for (let c = rect.left; c <= rect.right; c++) targets.push({row: r, col: columns[c], value: clipboard.cells[0][0]});
		} else {
			clipboard.cells.forEach((line, i) => line.forEach((value, j) => {
				const row = Math.max(0, rect.top) + i;
				const col = columns[rect.left + j];
				if (row < rowCount && col) targets.push({row, col, value});
			}));
		}
		const fits = targets.filter((t) => col_kind(t.col) === clipboard.kind);
		if (!fits.length) {
			flash(`Those cells can only be pasted into ${clipboard.kind === 'dca' ? "DCA" : clipboard.kind === 'qlab' ? "QLab" : "Text"} cells`);
			return;
		}

		// A cut clears its cells first (except ones being pasted over), then the paste goes in
		const ops = [];
		if (clipboard.cut) {
			const pasted = new Set(fits.map((t) => `${cue_key(cues[t.row])}|${t.col}`));
			clipboard.keys.forEach((key) => clipboard.cols.forEach((col) => {
				if (!pasted.has(`${key}|${col}`)) ops.push(...clearCellOps(key, col));
			}));
		}
		for (const t of fits) ops.push(...setCellOps(cues[t.row], t.col, t.value, {merge}));
		const result = await runEdit(ops);
		if (result && clipboard.cut) set_clipboard(null);
	}

	/** Paste Swap: the copied DCA cell and the selected one trade places */
	const pasteSwap = async () => {
		if (clipboard?.kind !== 'dca' || !selection) return;
		const target = cues[selection.focus.row];
		const sourceCue = showData.cues.find((c) => cue_key(c) === clipboard.keys[0]);
		if (!target || !sourceCue || col_kind(selection.focus.col) !== 'dca') return;
		const sourceDca = dca_of(clipboard.cols[0]);
		const targetDca = dca_of(selection.focus.col);
		const a = read_dca(showData, sourceCue, sourceDca);
		const b = read_dca(showData, target, targetDca);
		await runEdit([
			{op: 'set_dca', cue: cue_key(target), dca: targetDca, ...a, exclusive: false},
			{op: 'set_dca', cue: cue_key(sourceCue), dca: sourceDca, ...b, exclusive: false},
		]);
		set_clipboard(null);
	}

	/** Fill Down: the top selected row into the rest of the selection (one row: from the row above) */
	const fillDown = async () => {
		const rows = selectedCueRows();
		if (!rows.length) return;
		const from = rows.length > 1 ? rows[0] : rows[0] - 1;
		const into = rows.length > 1 ? rows.slice(1) : rows;
		if (from < 0) return;
		const ops = [];
		for (let c = rect.left; c <= rect.right; c++) {
			const col = columns[c];
			if (col === 'cue') continue;
			const value = col_kind(col) === 'dca' ? read_dca(showData, cues[from], dca_of(col)) : cellText(cues[from], col);
			for (const r of into) ops.push(...setCellOps(cues[r], col, value));
		}
		await runEdit(ops);
	}

	/** Delete / Backspace: clear the selected cells */
	const clearSelection = async () => {
		const ops = [];
		for (const r of selectedCueRows()) {
			for (let c = rect.left; c <= rect.right; c++) {
				const col = columns[c];
				if (col !== 'cue') ops.push(...clearCellOps(cue_key(cues[r]), col));
			}
		}
		await runEdit(ops);
	}

	const insertCue = async () => {
		const row = selection?.focus.row ?? -1;
		const result = await runEdit([{op: 'insert_cue', after: row >= 0 ? cue_key(cues[row]) : null}]);
		if (result) selectKey(result.show, result.results[0].key, 'text');
	}

	const cloneCue = async (to_end) => {
		const row = selection?.focus.row;
		if (row === undefined || row < 0) return;
		const result = await runEdit([{op: 'clone_cue', cue: cue_key(cues[row]), to_end}]);
		if (result) selectKey(result.show, result.results[0].key, 'cue');
	}

	const deleteCues = async () => {
		const rows = selectedCueRows();
		if (!rows.length) return;
		const keys = rows.map((r) => cue_key(cues[r]));
		if (keys.includes(activeKeyRef.current)) {
			// The active cue is going: Line Checks becomes the active row (nothing is fired)
			activeKeyRef.current = null;
		}
		const result = await runEdit([{op: 'delete_cues', cues: keys}]);
		if (result) {
			const row = Math.min(rows[0], result.show.cues.length - 1);
			set_selection(row >= 0 ? {anchor: {row, col: 'cue'}, focus: {row, col: 'cue'}} : null);
		}
	}

	const toggleSkip = async () => {
		const rows = selectedCueRows();
		const skip = rows.some((r) => !Number(cues[r].skip)) ? 1 : 0;
		await runEdit(rows.map((r) => ({op: 'set_cue_field', cue: cue_key(cues[r]), field: 'skip', value: skip})));
	}

	const renumber = async (increment) => {
		const row = renumber_dialog;
		const result = await runEdit([{op: 'renumber', from: cue_key(cues[row]), increment}]);
		if (!result) return "Couldn't renumber those cues";
		// The active cue keeps its row; follow its new number
		if (cue_index >= 0) activeKeyRef.current = cue_key([...result.show.cues].sort(cue_sorter)[cue_index]);
		set_renumber_dialog(null);
	}

	const openAssign = () => {
		const row = selection?.focus.row;
		const dca = dca_of(selection?.focus.col);
		if (!can_edit || row === undefined || row < 0 || dca === null) return;
		set_assign_dialog({key: cue_key(cues[row]), dca});
	}

	const saveAssign = async (values) => {
		const {key, dca} = assign_dialog;
		set_assign_dialog(null);
		await runEdit([{op: 'set_dca', cue: key, dca, ...values}]);
	}

	/** Right-click a cue number / text: highlight color */
	const pickColor = async (event, row) => {
		event.preventDefault();
		if (!can_edit || row < 0) return;
		selectCell(row, 'cue');
		const color = await window.editorApi.colorMenu(Number(cues[row].colour) || 0);
		if (color !== null) await runEdit([{op: 'set_cue_field', cue: cue_key(cues[row]), field: 'colour', value: color}]);
	}

	// #endregion

	/**
	 * Action → Jump...: fire a cue by its number ("12", "12.5", or "0" for line checks)
	 * @param {String} text
	 * @returns {String | undefined} error message if the cue doesn't exist
	 */
	const jumpToCueNumber = (text) => {
		const parsed = parse_cue_number(text);
		if (!parsed) return "Enter a cue number like 12 or 12.5";

		const {number, point} = parsed;
		const is_line_checks = number === 0 && point === 0;

		const index = is_line_checks
			? -1
			: cues.findIndex((cue) => Number(cue.number) === number && Number(cue.point) === point);

		if (index === -1 && !is_line_checks) return `There is no cue ${format_cue_number(number, point)}`;

		set_jump_dialog_open(false);
		goToRow(index);
	}

	/**
	 * Action → Test QLab Recall: start the selected (or current) cue's QLab cue
	 * without firing the cue
	 */
	const testQLabRecall = async () => {
		const row = selection?.focus.row ?? cue_index;
		const cue = row >= 0 ? cues[row] : null;

		if (!cue?.qLabCue) {
			console.log("[Editor] Test QLab Recall: the selected cue has no QLab cue");
			return;
		}

		const result = await window.qlabApi.recall(cue.qLabCue);
		if (!result.ok) {
			console.warn(`[Editor] Test QLab Recall failed: ${result.error}`);
		}
	}

	/**
	 * OSC /select: move the selection up, down, or to the current cue
	 * @param {'up' | 'down' | 'current'} direction
	 */
	const moveSelection = (direction) => {
		const last = rowCount - 1;
		const from = selection?.focus.row ?? cue_index;

		const next = direction === 'current' ? cue_index
			: direction === 'up' ? Math.max(-1, from - 1)
			: Math.min(last, from + 1);

		selectCell(next, 'cue');
	}

	/**
	 * Edit → Undo / Redo: text fields get a normal undo, otherwise undo show edits
	 * @param {'undo' | 'redo'} action
	 */
	const undoRedo = async (action) => {
		if (is_text_field(document.activeElement)) {
			document.execCommand(action);
			return;
		}

		// Works with editing locked too: it's always a deliberate command
		if (showData === null) return;

		const show = action === 'undo' ? await window.showApi.undo() : await window.showApi.redo();

		if (show !== null) {
			setShowData(show);
			const active = activeKeyRef.current;
			const cue = active && show.cues.find((c) => cue_key(c) === active);
			if (cue) fireCueObject(cue, show);
		}
	}

	/** Cut / Copy / Paste from the menu: the text field being typed in, else the cells */
	const clipboardAction = (action) => {
		if (is_text_field(document.activeElement)) {
			document.execCommand(action);
			return;
		}
		if (!can_edit && action !== 'copy') return;
		if (action === 'copy') copySelection(false);
		else if (action === 'cut') copySelection(true);
		else paste();
	}

	/**
	 * Commands from the app menu, toolbar and OSC
	 * @param {String | {action: String, arg?: any, remote?: boolean}} message
	 */
	const handleMenuAction = (message) => {
		const {action, arg, remote = false} = typeof message === 'string' ? {action: message} : message;

		if (action === 'undo' || action === 'redo') {
			undoRedo(action);
			return;
		}
		if (action === 'cut' || action === 'copy' || action === 'paste') {
			if (!dialog_open) clipboardAction(action);
			return;
		}

		// Menu shortcuts are ignored while a popup is open; OSC commands still run
		if ((dialog_open && !remote) || showData === null) return;

		switch (action) {
			case 'go':
				goToRow(nextPlayable(cue_index, 1));
				break;
			case 'back':
				goToRow(nextPlayable(cue_index, -1), {back: true});
				break;
			case 'jump-to':
				jumpToCueNumber(String(arg));
				break;
			case 'select':
				moveSelection(arg);
				break;
			case 'test-qlab':
				testQLabRecall();
				break;
			case 'jump':
				set_jump_dialog_open(true);
				break;
			case 'jump-selected':
				if (selection) goToRow(selection.focus.row);
				break;
			case 'paste-merge':
				paste({merge: true});
				break;
			case 'paste-swap':
				pasteSwap();
				break;
			case 'fill-down':
				fillDown();
				break;
			case 'insert-cue':
				insertCue();
				break;
			case 'clone-cue':
				cloneCue(false);
				break;
			case 'clone-cue-end':
				cloneCue(true);
				break;
			case 'delete-cue':
				deleteCues();
				break;
			case 'skip-cue':
				toggleSkip();
				break;
			case 'renumber':
				if (selection && selection.focus.row >= 0) set_renumber_dialog(selection.focus.row);
				break;
			case 'assign':
				openAssign();
				break;
			case 'clear-assignment':
				clearSelection();
				break;
			case 'store-settings':
				storeSettings();
				break;
			case 'channel-utilisation':
				set_cell_edit(null);
				set_utilisation_open(true);
				break;
			case 'mark-selected':
				if (selection) openMark(selection.focus.row, false);
				break;
			case 'mark-current':
				openMark(cue_index, true);
				break;
			case 'show-setup':
			case 'ensemble-setup':
			case 'position-setup':
			case 'actor-setup':
				set_cell_edit(null);
				set_setup_dialog(action);
				break;
		}
	}

	/**
	 * Store Channel Settings from Console (toolbar, ⌥⌘S): the gain / HPF / EQ / dynamics of the
	 * selected DCA's channels (or every channel in the selected cue, or in the running cue), for
	 * the character each plays in that cue. Sections a profile stores per actor go to the actor
	 * playing it; a profile that stores nothing yet starts storing everything.
	 */
	const storeSettings = async () => {
		const row = selection?.focus.row ?? cue_index;
		const cue = row >= 0 ? cues[row] : null;
		if (!cue) { flash("Select a cue (or a DCA in one) to store its channels' settings"); return; }
		const dca = selection && selection.focus.row === row ? dca_of(selection.focus.col) : null;
		const channels = dca !== null ? parse_channels(cue[dca_field(dca, 'Channels')])
			: [...new Set(Array.from({length: MAX_DCAS}, (_, i) => parse_channels(cue[dca_field(i + 1, 'Channels')])).flat())];
		if (!channels.length) { flash(dca !== null ? "That DCA has no channels" : "Nobody is assigned in that cue"); return; }

		const profiles = parse_map(cue.channelProfiles);
		const edited = new Map();   // profile id -> profile with flags added
		const ops = [];
		const stored = [];
		for (const ch of channels) {
			const id = profiles.get(ch);
			let profile = (id !== undefined && showData.profiles.find((p) => String(p.id) === id)) || default_profile(showData, ch);
			if (!profile) continue;
			let flags = profile_flags(edited.get(profile.id) ?? profile);
			if (!flags.store.size && !flags.actor.size) {
				flags = {store: new Set(SETTING_SECTIONS), actor: flags.actor};
				edited.set(profile.id, {...profile, data: with_profile_flags(profile.data, flags)});
			}
			const sections = [...new Set([...flags.store, ...flags.actor])];
			const result = await window.presonus.captureSettings(ch, sections);
			if (!result.ok) { flash(result.error); return; }
			const actor = showData.actors?.filter((a) => Number(a.channel) === ch && Number(a.active)).sort((a, b) => Number(a.order) - Number(b.order))[0];
			for (const [section, values] of Object.entries(result.settings)) {
				const owner = flags.actor.has(section) && actor ? `actor:${actor.id}:${profile.id}` : `profile:${profile.id}`;
				ops.push({op: 'set_channel_settings', owner, section, data: JSON.stringify(values)});
			}
			stored.push(profile.name || `Ch ${ch}`);
		}
		if (edited.size) ops.unshift({op: 'set_profiles', profiles: showData.profiles.map((p) => edited.get(p.id) ?? p)});
		if (await runEdit(ops, {setup: true})) flash(`Stored settings from the console for ${stored.join(", ")}`, 'info');
	}

	/**
	 * Action → Mark Selected / Current Cue
	 * @param {Number} row
	 * @param {boolean} current marking the running cue: the note closes when the next cue fires
	 */
	const openMark = (row, current) => {
		const cue = row >= 0 ? cues[row] : null;
		const key = cue ? cue_key(cue) : null;
		const number = cue ? format_cue_number(cue.number, cue.point) : "0";
		set_mark_dialog({key, current, title: `Mark Cue ${number} - ${cue ? cue.name : "Line Checks"}`});
	}

	const saveMark = async (note) => {
		const {key} = mark_dialog;
		set_mark_dialog(null);
		const list = await window.cueInfoApi.mark(key, note);
		set_marks(Object.fromEntries(list.map((m) => [m.key ?? "", m.note])));
	}

	// Marks start over with each show; refresh when one is made elsewhere (console button)
	useEffect(() => {
		const refresh = () => window.cueInfoApi.getMarks().then((list) => set_marks(Object.fromEntries(list.map((m) => [m.key ?? "", m.note]))));
		refresh();
		return window.cueInfoApi.onChange(refresh);
	}, [showData === null]);

	// The note for the running cue closes (and is kept) when the next cue fires
	const markRef = useRef(null);
	markRef.current = {mark_dialog, saveMark};
	useEffect(() => {
		return window.cueInfoApi.onChange((info) => {
			const {mark_dialog: open, saveMark: save} = markRef.current;
			if (open?.current && info.current.key !== open.key) {
				const textarea = document.querySelector('[role=dialog] textarea');
				save(textarea?.value ?? "");
			}
		});
	}, []);

	// The subscription is made once, so always call the latest handler
	const menuHandlerRef = useRef(handleMenuAction);
	menuHandlerRef.current = handleMenuAction;

	useEffect(() => {
		const unsubscribeMenu = window.menuApi.onMenuAction((action) => menuHandlerRef.current(action));
		const unsubscribeView = window.menuApi.onViewSettings(set_view);

		window.menuApi.getViewSettings().then(set_view);

		return () => {
			unsubscribeMenu();
			unsubscribeView();
		};
	}, []);

	// Show closed: clear the active / selected cue
	useEffect(() => {
		if (showData === null) {
			set_index(-1);
			activeKeyRef.current = null;
			set_selection(null);
			set_clipboard(null);
			set_cell_edit(null);
		}
	}, [showData]);

	// Cues added, removed or renumbered: keep the active cue (by its key) and the selection in range
	useEffect(() => {
		const key = activeKeyRef.current;
		const index = key === null ? -1 : cues.findIndex((c) => cue_key(c) === key);
		if (index !== cue_index) set_index(index);
		if (key !== null && index === -1) activeKeyRef.current = null;
		set_selection((prev) => prev && (prev.anchor.row >= rowCount || prev.focus.row >= rowCount)
			? {anchor: {row: Math.min(prev.anchor.row, rowCount - 1), col: prev.anchor.col}, focus: {row: Math.min(prev.focus.row, rowCount - 1), col: prev.focus.col}}
			: prev);
	}, [cues]);

	// Editing locked: stop any typing and forget a cut
	useEffect(() => {
		if (view.lockEditing) {
			set_cell_edit(null);
			set_clipboard((prev) => prev?.cut ? null : prev);
		}
	}, [view.lockEditing]);

	/**
	 * Keys: Space = Go, Ctrl+Space = Back. With editing locked, ↑ / ↓ are Back / Go; unlocked they
	 * move the selection (Shift extends it), Enter edits, typing replaces a cell, Delete clears,
	 * ⌘⌫ deletes cues, Escape drops a cut.
	 */
	const handleGlobalKey = (event) => {
		// Don't fire cues while a popup is open or while typing
		if (dialog_open || cell_edit || is_text_field(event.target)) {
			return;
		}

		const mod = event.metaKey || event.ctrlKey;
		const handled = () => event.preventDefault();

		if (event.code === 'Space') {
			handled();
			if (event.ctrlKey) goToRow(nextPlayable(cue_index, -1), {back: true}); else goToRow(nextPlayable(cue_index, 1));
			return;
		}

		if (!can_edit) {
			if (event.code === 'ArrowUp') { handled(); goToRow(nextPlayable(cue_index, -1), {back: true}); }
			else if (event.code === 'ArrowDown') { handled(); goToRow(nextPlayable(cue_index, 1)); }
			return;
		}

		const focus = selection?.focus ?? {row: cue_index, col: 'cue'};
		const arrows = {ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]};
		if (arrows[event.code] && !mod) {
			handled();
			const [dr, dc] = arrows[event.code];
			const row = Math.max(-1, Math.min(rowCount - 1, focus.row + dr));
			const col = columns[Math.max(0, Math.min(columns.length - 1, colIndex(focus.col) + dc))];
			selectCell(row, col, event.shiftKey);
			return;
		}

		if (!selection) return;

		if (event.key === 'Escape') {
			set_clipboard((prev) => prev?.cut ? null : prev);
		} else if (event.key === 'Enter') {
			handled();
			if (col_kind(focus.col) === 'dca') openAssign(); else startEdit(focus.row, focus.col);
		} else if ((event.key === 'Backspace' || event.key === 'Delete') && mod) {
			handled();
			deleteCues();
		} else if (event.key === 'Backspace' || event.key === 'Delete') {
			handled();
			clearSelection();
		} else if (event.key.length === 1 && !mod && !event.altKey && focus.row >= 0) {
			// Typing replaces the cell
			handled();
			startEdit(focus.row, focus.col, event.key);
		}
	};

	useEffect(() => {
		window.addEventListener('keydown', handleGlobalKey);

		// Clean up listener when component unmounts
		return () => window.removeEventListener('keydown', handleGlobalKey);
	});

	/**
	 * Double click a cue number / text: with editing unlocked it edits the cell (⌘ double click
	 * jumps to the cue, like TheatreMix, so a stray double click doesn't fire one); locked, it
	 * jumps. A DCA cell opens Assign.
	 */
	const handleDoubleClick = (event, row, col) => {
		if (view.lockEditing || event.metaKey || event.ctrlKey || row < 0) {
			if (col_kind(col) !== 'dca' && col !== 'qlab') goToRow(row);
			return;
		}
		if (col_kind(col) === 'dca') openAssign(); else startEdit(row, col);
	}

	const cellProps = (row, col) => ({
		onMouseDown: (event) => {
			if (event.button !== 0) return;
			if (cell_edit && (cell_edit.row !== row || cell_edit.col !== col)) commitEdit();
			selectCell(row, col, event.shiftKey);
		},
		onDoubleClick: (event) => handleDoubleClick(event, row, col),
	});

	/** Selected cells fill blue; a cut cell is struck through */
	const cellStyle = (style, row, col, extra = {}) => {
		const cut = clipboard?.cut && row >= 0 && clipboard.keys.includes(cue_key(cues[row])) && clipboard.cols.includes(col);
		return {
			...sized(style),
			...extra,
			...(isSelected(row, col) ? {backgroundColor: SELECTED_COLOR, color: TEXT_COLOR} : {}),
			...(cut ? {textDecoration: 'line-through', opacity: 0.6} : {}),
		};
	}

	const editorFor = (row, col) => cell_edit && cell_edit.row === row && cell_edit.col === col
		? <input
			autoFocus
			style={CELL_EDITOR_STYLE}
			value={cell_edit.text}
			onChange={(e) => set_cell_edit({...cell_edit, text: e.target.value})}
			onFocus={(e) => { if (cell_edit.text.length > 1) e.target.select(); }}
			onKeyDown={(e) => {
				if (e.key === 'Enter') { e.preventDefault(); commitEdit({force: e.metaKey || e.ctrlKey}); }
				else if (e.key === 'Escape') { e.preventDefault(); set_cell_edit(null); }
				else if (e.key === 'Tab') {
					e.preventDefault();
					commitEdit();
					const next = columns[Math.max(0, Math.min(columns.length - 1, colIndex(col) + (e.shiftKey ? -1 : 1)))];
					selectCell(row, next);
				}
				e.stopPropagation();
			}}
			onBlur={() => commitEdit()}
			aria-label="Edit cell"
		/>
		: null;

	if (showData === null) {
		return <div style={CONTAINER_STYLE}><div style={SCROLL_BOX_STYLE}/></div>;
	}

	/** One DCA cell (next: the cue Go fires after this one, for the cell's color) */
	const dcaCell = (cue, row, dca, rowColor, anyAssigned, next) => {
		const col = `dca${dca}`;
		const channels = parse_channels(cue[dca_field(dca, 'Channels')]);
		const custom = cue[dca_field(dca, 'Label')];
		const label = channels.length ? get_DCA_label(showData, cue, dca) : (custom && custom !== "-" ? custom : "");
		const level = channels.length ? get_dca_level(showData.dcaLevels, cue, dca) : null;
		const offsets = parse_map(cue.channelLevels);
		const hasOffsets = channels.some((ch) => offsets.has(ch));
		const background = !anyAssigned ? rowColor : channels.length > 1 ? ENSEMBLE_DCA_BACKGROUND : ASSIGNED_DCA_BACKGROUND;
		// TheatreMix's color coding: what happens to this DCA in the next cue
		const raw = channels.length ? dca_next_state(cue, next, dca) : 'off';
		const state = view.colorBlindDca ? color_blind_state(raw) : raw;
		// View → Positions: each channel's position code
		const positions = view.showPositions && channels.length ? (() => {
			const map = parse_map(cue.channelPositions);
			const codes = channels.map((ch) => showData.positions?.find((p) => String(p.id) === (map.get(ch) ?? String(showData.positions?.[0]?.id)))?.shortName ?? "?");
			return [...new Set(codes)].join(" ");
		})() : null;

		return (
			<td
				key={dca}
				style={cellStyle(DCA_ITEM_STYLE, row, col, {
					backgroundColor: background,
					...(DCA_STATE_COLORS[state]?.[channels.length > 1 ? 0 : 1] ?? {}),
					...(hasOffsets ? {textDecoration: 'underline'} : {}),
					...(!channels.length ? {color: PLACEHOLDER_TEXT_COLOR} : {}),
					cursor: can_edit ? 'cell' : 'default',
				})}
				title={channels.length ? `Channels ${channels.join(", ")}${hasOffsets ? " (with level offsets)" : ""}` : undefined}
				{...cellProps(row, col)}
			>
				{editorFor(row, col) ?? <>
					{label}
					{positions ? <div style={DCA_LEVEL_STYLE}>{positions}</div> : null}
					{level !== null ? <div style={DCA_LEVEL_STYLE}>{format_dca_level(level)}</div> : null}
				</>}
			</td>
		);
	}

	const assignCue = assign_dialog && showData.cues.find((c) => cue_key(c) === assign_dialog.key);

	return <div style={CONTAINER_STYLE}>
		<div style={{flex: 1, minWidth: 0, display: "flex", flexDirection: "column"}}>
		<div style={SCROLL_BOX_STYLE}>
		<table style={{...TABLE_STYLE, minWidth: TABLE_FIXED_WIDTH + (show_qlab ? QLAB_COLUMN_WIDTH : 0) + DCA_NUMBERS.length * DCA_MIN_WIDTH}}>
			<colgroup>
				<col style={{width: CUE_COLUMN_WIDTH}}/>
				<col style={{width: TEXT_COLUMN_WIDTH}}/>
				{show_qlab && <col style={{width: QLAB_COLUMN_WIDTH}}/>}
				{DCA_NUMBERS.map((dca) => <col key={dca}/>)}
			</colgroup>

			{/* Table Header */}
			<thead>
			<tr>
				<th style={HEADER_ITEM_STYLE}>Cue</th>
				<th style={HEADER_ITEM_STYLE}>Text</th>
				{show_qlab && <th style={HEADER_ITEM_STYLE}>QLab</th>}
				{DCA_NUMBERS.map((dca) => <th key={dca} style={HEADER_ITEM_STYLE}>DCA {dca}</th>)}
			</tr>
			</thead>

			{/* Table Body */}
			<tbody>
				<tr
					key={-1}
					style={row_style(get_cue_color(-1), -1 === cue_index)}
					aria-current={-1 === cue_index ? "true" : undefined}
					ref={(el) => (rowRefs.current[0] = el)}
				>
					<td style={active_cell(cellStyle(CUE_ITEM_STYLE, -1, 'cue'), -1 === cue_index)} {...cellProps(-1, 'cue')}>0</td>
					<td style={cellStyle(LINE_CHECKS_ITEM_STYLE, -1, 'text')} {...cellProps(-1, 'text')}>Line Checks</td>
					{show_qlab && <td style={cellStyle(CUE_ITEM_STYLE, -1, 'qlab')} {...cellProps(-1, 'qlab')}></td>}
					{DCA_NUMBERS.map((dca) => <td key={dca} style={cellStyle(DCA_ITEM_STYLE, -1, `dca${dca}`)} {...cellProps(-1, `dca${dca}`)}></td>)}
				</tr>
				{cues.map((cue, index) => {
					const color = get_cue_color(Number(cue.colour));
					const active = index === cue_index;
					const skipped = Number(cue.skip) === 1;
					const anyAssigned = DCA_NUMBERS.some((d) => parse_channels(cue[dca_field(d, 'Channels')]).length);
					const textColor = skipped ? {color: SKIPPED_TEXT_COLOR, fontStyle: 'italic', textDecoration: 'line-through'} : {};
					const next = next_cue(showData.cues, cue);
					return (
						<tr
							key={cue_key(cue)}
							style={{...row_style(color, active), ...textColor}}
							aria-current={active ? "true" : undefined}
							ref={(el) => (rowRefs.current[index + 1] = el)}
							title={skipped ? "Skipped: Go passes over this cue" : undefined}
						>
							<td style={active_cell(cellStyle(CUE_ITEM_STYLE, index, 'cue', textColor), active)} {...cellProps(index, 'cue')} onContextMenu={(e) => pickColor(e, index)}>
								{editorFor(index, 'cue') ?? format_cue_number(cue.number, cue.point)}
								{marks[cue_key(cue)] !== undefined ? <span style={MARK_STYLE} title={marks[cue_key(cue)] || "Marked"}>●</span> : null}
							</td>
							<td style={cellStyle(ROW_ITEM_STYLE, index, 'text', textColor)} {...cellProps(index, 'text')} onContextMenu={(e) => pickColor(e, index)} title={cue.name}>
								{editorFor(index, 'text') ?? cue.name}
							</td>
							{show_qlab && <td style={cellStyle(CUE_ITEM_STYLE, index, 'qlab', textColor)} {...cellProps(index, 'qlab')} title={cue.qLabCue ? `QLab cue ${cue.qLabCue}` : undefined}>
								{editorFor(index, 'qlab') ?? cue.qLabCue}
							</td>}
							{DCA_NUMBERS.map((dca) => dcaCell(cue, index, dca, color, anyAssigned, next))}
						</tr>
					);
				})}
			</tbody>

		</table>
		</div>
		<BackupTray show={showData}/>
		</div>

		{toast ? <div style={{...TOAST_STYLE, ...(toast.kind === 'info' ? TOAST_INFO_STYLE : {})}} role="status" data-toast>{toast.message}</div> : null}

		{assignCue && (
			<AssignDialog
				show={showData}
				cue={assignCue}
				dca={assign_dialog.dca}
				onSave={saveAssign}
				onCancel={() => set_assign_dialog(null)}
			/>
		)}

		{renumber_dialog !== null && cues[renumber_dialog] && (
			<RenumberDialog
				start={`Cue ${format_cue_number(cues[renumber_dialog].number, cues[renumber_dialog].point)} - ${cues[renumber_dialog].name}`}
				onRenumber={renumber}
				onCancel={() => set_renumber_dialog(null)}
			/>
		)}

		{setup_dialog && React.createElement(SETUP_DIALOGS[setup_dialog], {
			show: showData,
			onSave: async (ops) => { if (await runEdit(ops, {setup: true})) set_setup_dialog(null); },
			onCancel: () => set_setup_dialog(null),
		})}

		{utilisation_open && (
			<ChannelUtilisation
				show={showData}
				activeKey={activeKeyRef.current}
				runEdit={runEdit}
				onSelectCue={(key) => { set_utilisation_open(false); selectKey(showData, key, 'cue'); }}
				onClose={() => set_utilisation_open(false)}
			/>
		)}

		{mark_dialog && (
			<MarkDialog
				title={mark_dialog.title}
				note={marks[mark_dialog.key ?? ""] ?? ""}
				onSave={saveMark}
				onCancel={() => set_mark_dialog(null)}
			/>
		)}

		{jump_dialog_open && (
			<JumpDialog
				onJump={jumpToCueNumber}
				onCancel={() => set_jump_dialog_open(false)}
			/>
		)}
	</div>;
}

export default Editor;
