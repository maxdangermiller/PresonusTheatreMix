import React, { useEffect, useRef, useState } from 'react';

import Dialog, { INPUT_STYLE, ERROR_STYLE } from './Dialog.jsx';

/**
 * @typedef {Object} RenumberDialogProps
 * @property {String} start - the first cue to renumber, e.g. "Cue 2.1 - Soloists"
 * @property {Function} onRenumber - called with the increment (e.g. 1 or 0.1); returns an error string if it can't
 * @property {Function} onCancel
 */

/**
 * Edit → Renumber Cues...: renumber from the selected cue to the end, each cue `increment`
 * after the last (like TheatreMix)
 * @param {RenumberDialogProps} props
 */
const RenumberDialog = ({start, onRenumber, onCancel}) => {
	const [text, setText] = useState("1");
	const [error, setError] = useState("");
	const inputRef = useRef(null);

	useEffect(() => {
		inputRef.current?.select();
	}, []);

	const submit = async () => {
		const increment = parseFloat(text);
		if (!(increment > 0)) {
			setError("Enter an increment like 1 or 0.1");
			return;
		}
		const result = await onRenumber(increment);
		if (result) setError(result);
	}

	return (
		<Dialog title="Renumber Cues" width={360} onCancel={onCancel} onSubmit={submit}>
			<div>Start at: <b>{start}</b></div>
			<label style={{display: "flex", alignItems: "center", gap: "8px"}}>
				Increment by:
				<input
					ref={inputRef}
					type="number"
					min={0.01}
					step={0.1}
					value={text}
					onChange={(e) => { setText(e.target.value); setError(""); }}
					style={{...INPUT_STYLE, width: "90px"}}
					aria-label="Increment"
				/>
			</label>
			<div style={{fontSize: 13, opacity: 0.7}}>
				Every cue from this one to the end is renumbered in order, each this much after the last.
			</div>
			<div style={ERROR_STYLE}>{error}</div>
		</Dialog>
	);
}

export default RenumberDialog;
