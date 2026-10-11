import React, { useState } from 'react';

import Dialog, { INPUT_STYLE } from './Dialog.jsx';

/**
 * @typedef {Object} MarkDialogProps
 * @property {String} title - e.g. "Mark Cue 2.1 - Soloists"
 * @property {String} note - the cue's note so far
 * @property {Function} onSave - called with the note
 * @property {Function} onCancel
 */

/**
 * Action → Mark Selected / Current Cue: flag a cue with a note during a run, to deal with
 * after the show (File → Export Notes)
 * @param {MarkDialogProps} props
 */
const MarkDialog = ({title, note, onSave, onCancel}) => {
	const [text, setText] = useState(note ?? "");

	return (
		<Dialog title={title} width={460} onCancel={onCancel} onSubmit={() => onSave(text)} submitLabel="Mark">
			<textarea
				autoFocus
				value={text}
				onChange={(e) => setText(e.target.value)}
				onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
				placeholder="Note (optional), e.g. Nala's mic late"
				rows={4}
				style={{...INPUT_STYLE, width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "Arial"}}
				aria-label="Note"
			/>
			<div style={{fontSize: 13, opacity: 0.7}}>⌘Enter marks it. Marks last for this session; File → Export Notes saves them as a web page.</div>
		</Dialog>
	);
}

export default MarkDialog;
