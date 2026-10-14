import React, { useState } from 'react';

import Dialog, { BUTTON_STYLE, INPUT_STYLE } from './Dialog.jsx';

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
 * Settings… (⌘,): the cue list's font size, and putting resized columns back
 * @param {PreferencesDialogProps} props
 */
const PreferencesDialog = ({fontSize, hasColumnWidths, onSave, onResetColumns, onCancel}) => {
	const [size, setSize] = useState(fontSize);
	const clamp = (n) => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(n) || fontSize));

	return (
		<Dialog title="Settings" width={460} onCancel={onCancel} onSubmit={() => onSave({fontSize: clamp(size)})}>
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
			<div style={{fontSize: clamp(size), fontFamily: "Arial", border: "1px solid #444", padding: "4px 8px", whiteSpace: "nowrap", overflow: "hidden"}}>
				1.5 &nbsp; Circle of Life
			</div>
			<div style={NOTE_STYLE}>View → Row Size picks a preset size (16, 22 or 30 px) instead.</div>

			<div style={{...ROW_STYLE, borderTop: "1px solid #444", paddingTop: 12}}>
				<button style={BUTTON_STYLE} disabled={!hasColumnWidths} onClick={onResetColumns}>Reset column widths</button>
				<span style={NOTE_STYLE}>Drag the edge of a column's header to resize it; double-click the edge to reset one.</span>
			</div>
		</Dialog>
	);
}

export default PreferencesDialog;
