import React, { useEffect, useRef, useState } from 'react';

import Dialog, { BUTTON_STYLE, INPUT_STYLE } from './Dialog.jsx';
import { themed } from './utils/colors.jsx';

// Same range the main process allows (main/settings.js)
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 48;

const ROW_STYLE = {display: "flex", alignItems: "center", gap: 10}
const NOTE_STYLE = {fontSize: 13, opacity: 0.7}

/**
 * @typedef {Object} PreferencesDialogProps
 * @property {Number} fontSize - the cue list's font size now
 * @property {Boolean} hasColumnWidths - some columns have been resized
 * @property {Function} onSave - called with {fontSize}
 * @property {Function} onResetColumns
 * @property {Function} onCancel
 */

/**
 * Settings… (⌘,): the theme, the cue list's font size, and putting resized columns back
 * @param {PreferencesDialogProps} props
 */
const PreferencesDialog = ({fontSize, hasColumnWidths, onSave, onResetColumns, onCancel}) => {
	const [size, setSize] = useState(fontSize);
	const clamp = (n) => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(n) || fontSize));

	// Theme: picking one shows it straight away; Cancel puts the one from before back
	const [theme, setTheme] = useState(null);
	const startTheme = useRef(null);
	useEffect(() => {
		window.themeApi?.get().then((state) => { startTheme.current = state.id; setTheme(state); });
	}, []);
	const pickTheme = async (id) => setTheme(await window.themeApi.set(id));
	const cancel = () => {
		if (theme && startTheme.current && theme.id !== startTheme.current) window.themeApi.set(startTheme.current);
		onCancel();
	}

	return (
		<Dialog title="Settings" width={460} onCancel={cancel} onSubmit={() => onSave({fontSize: clamp(size)})}>
			<div style={ROW_STYLE}>
				<label htmlFor="theme">Theme:</label>
				<select id="theme" value={theme?.id ?? ""} onChange={(e) => pickTheme(e.target.value)} style={{...INPUT_STYLE, flex: 1}} disabled={!theme}>
					{(theme?.themes ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}{t.custom ? " (custom)" : ""}</option>)}
				</select>
				<button style={BUTTON_STYLE} onClick={() => window.themeApi.openFolder()} title="Custom themes are .json files in this folder (it has a README with an example)">Themes Folder…</button>
			</div>
			<div style={{...NOTE_STYLE, marginTop: -6}}>Also in View → Theme. Make your own theme: open the Themes Folder and follow its README.</div>

			<div style={ROW_STYLE}>
				<label htmlFor="font-size">Cue list font size:</label>
				<input
					id="font-size"
					type="range"
					min={MIN_FONT_SIZE}
					max={MAX_FONT_SIZE}
					value={size}
					onChange={(e) => setSize(Number(e.target.value))}
					style={{flex: 1}}
				/>
				<input
					type="number"
					min={MIN_FONT_SIZE}
					max={MAX_FONT_SIZE}
					value={size}
					onChange={(e) => setSize(Number(e.target.value))}
					onBlur={() => setSize(clamp(size))}
					style={{...INPUT_STYLE, width: 56, textAlign: "right"}}
					aria-label="Font size in pixels"
				/> px
			</div>
			<div style={{fontSize: clamp(size), fontFamily: "Arial", border: `1px solid ${themed('line')}`, padding: "4px 8px", whiteSpace: "nowrap", overflow: "hidden"}}>
				1.5 &nbsp; Circle of Life
			</div>
			<div style={NOTE_STYLE}>View → Row Size picks a preset size (16, 22 or 30 px) instead.</div>

			<div style={{...ROW_STYLE, borderTop: `1px solid ${themed('line')}`, paddingTop: 12}}>
				<button style={{...BUTTON_STYLE, whiteSpace: "nowrap", flexShrink: 0}} disabled={!hasColumnWidths} onClick={onResetColumns}>Reset column widths</button>
				<span style={NOTE_STYLE}>Drag the edge of a column's header to resize it; double-click the edge to reset one.</span>
			</div>
		</Dialog>
	);
}

export default PreferencesDialog;
