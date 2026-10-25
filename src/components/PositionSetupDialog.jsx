import React, { useState } from 'react';

import Dialog, { BUTTON_STYLE, INPUT_STYLE } from './Dialog.jsx';
import { SELECTED_COLOR, themed } from './utils/colors.jsx';

const LIST_BOX_STYLE = {border: `1px solid ${themed('lineStrong')}`, backgroundColor: themed('panel'), overflowY: "auto", height: 230, flexShrink: 0};
const HEAD_STYLE = {textAlign: "left", fontWeight: "normal", fontSize: 13, opacity: 0.75, padding: "4px 8px", borderBottom: `1px solid ${themed('line')}`, position: "sticky", top: 0, backgroundColor: themed('panel')};
const CELL_STYLE = {padding: "3px 8px", fontSize: 14, whiteSpace: "nowrap"};

const MAX_DELAY_MS = 250;
const MAX_PAN = 100;

/** TheatreMix's pan readout: "Centre", "60 L", "60 R" */
const format_pan = (pan) => Number(pan) === 0 ? "Centre" : `${Math.abs(Number(pan))} ${Number(pan) < 0 ? "L" : "R"}`;
const format_delay = (ms) => Number(ms) > 0 ? `${ms} ms` : "0 ms";

/**
 * @typedef {Object} PositionSetupDialogProps
 * @property {Object} show
 * @property {Function} onSave - called with the edit ops to apply
 * @property {Function} onCancel
 */

/**
 * File → Position Setup: stage positions a channel can be in for a cue (Assign → Pos), each a
 * delay and pan. New assignments use the first position.
 * @param {PositionSetupDialogProps} props
 */
const PositionSetupDialog = ({show, onSave, onCancel}) => {
	const [positions, setPositions] = useState(() => (show.positions ?? []).map((p) => ({...p})));
	const [picked, setPicked] = useState(positions.length ? 0 : null);

	const update = (changes) => setPositions((prev) => prev.map((p, i) => i === picked ? {...p, ...changes} : p));
	const current = picked !== null ? positions[picked] : null;

	const add = () => {
		setPositions((prev) => [...prev, {id: null, name: "New Position", shortName: "NEW", delay: 0, pan: 0, buses: prev[0]?.buses ?? ""}]);
		setPicked(positions.length);
	}

	const remove = () => {
		if (picked === null || positions.length <= 1) return;
		setPositions((prev) => prev.filter((_, i) => i !== picked));
		setPicked(0);
	}

	const save = () => onSave([{op: 'set_positions', positions: positions.map((p) => ({
		...p,
		name: String(p.name ?? "").trim() || "Position",
		shortName: String(p.shortName ?? "").trim().slice(0, 4) || "POS",
		delay: Math.max(0, Math.min(MAX_DELAY_MS, Number(p.delay) || 0)),
		pan: Math.max(-MAX_PAN, Math.min(MAX_PAN, Math.round(Number(p.pan) || 0))),
	}))}]);

	return (
		<Dialog title="Position Setup" width={720} onCancel={onCancel} onSubmit={save}>
			<div style={LIST_BOX_STYLE}>
				<table style={{width: "100%", borderCollapse: "collapse"}}>
					<thead>
						<tr>
							<th style={HEAD_STYLE}>Position</th>
							<th style={HEAD_STYLE}>Code</th>
							<th style={HEAD_STYLE}>Delay</th>
							<th style={HEAD_STYLE}>Pan</th>
							<th style={HEAD_STYLE}>Buses</th>
						</tr>
					</thead>
					<tbody>
						{positions.map((p, i) => (
							<tr key={i} style={{backgroundColor: picked === i ? SELECTED_COLOR : "transparent"}} onMouseDown={() => setPicked(i)}>
								<td style={CELL_STYLE}>{p.name}{i === 0 ? <span style={{opacity: 0.6}}> (default)</span> : null}</td>
								<td style={CELL_STYLE}>{p.shortName}</td>
								<td style={CELL_STYLE}>{format_delay(p.delay)}</td>
								<td style={CELL_STYLE}>{format_pan(p.pan)}</td>
								<td style={{...CELL_STYLE, opacity: 0.6}}>{p.buses || "-"}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div style={{display: "flex", gap: 8}}>
				<button style={BUTTON_STYLE} onClick={add} title="Add a position">+</button>
				<button style={BUTTON_STYLE} onClick={remove} disabled={picked === null || positions.length <= 1} title="Remove the selected position (channels in it go to the first one)">−</button>
			</div>

			{current && <div style={{display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "10px 12px", alignItems: "center"}}>
				<label htmlFor="pos-name">Name:</label>
				<input id="pos-name" value={current.name ?? ""} onChange={(e) => update({name: e.target.value})} style={INPUT_STYLE}/>
				<span/>
				<label htmlFor="pos-code">Code:</label>
				<input id="pos-code" value={current.shortName ?? ""} maxLength={4} onChange={(e) => update({shortName: e.target.value})} style={{...INPUT_STYLE, width: 70}}/>
				<span style={{fontSize: 13, opacity: 0.7}}>shown in Assign's Pos column</span>
				<label htmlFor="pos-delay">Delay:</label>
				<input id="pos-delay" type="range" min={0} max={MAX_DELAY_MS} step={0.5} value={Number(current.delay) || 0} onChange={(e) => update({delay: Number(e.target.value)})}/>
				<span><input type="number" min={0} max={MAX_DELAY_MS} step={0.5} value={Number(current.delay) || 0} onChange={(e) => update({delay: Number(e.target.value)})} style={{...INPUT_STYLE, width: 70, textAlign: "right"}} aria-label="Delay in ms"/> ms</span>
				<label htmlFor="pos-pan">Pan:</label>
				<input id="pos-pan" type="range" min={-MAX_PAN} max={MAX_PAN} step={1} value={Number(current.pan) || 0} onChange={(e) => update({pan: Number(e.target.value)})} onDoubleClick={() => update({pan: 0})}/>
				<span style={{minWidth: 70}}>{format_pan(current.pan)}</span>
			</div>}
			<div style={{fontSize: 13, opacity: 0.7}}>
				New assignments use the first position. The buses come from TheatreMix (X32) and are kept as they are.
			</div>
		</Dialog>
	);
}

export default PositionSetupDialog;
