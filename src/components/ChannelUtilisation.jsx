import React, { useEffect, useMemo, useState } from 'react';

import Dialog, { BUTTON_STYLE, PRIMARY_BUTTON_STYLE, INPUT_STYLE } from './Dialog.jsx';
import { SELECTED_COLOR } from './utils/colors.jsx';
import { get_DCA_label } from './utils/cue_utils.js';
import { cue_key, cue_value, dca_field, parse_channels, controlled_channels, default_profile, read_dca, MAX_DCAS } from '../utils/show_edits.js';
import { format_cue_number } from '../utils/cue_number.js';

const GRID_BOX_STYLE = {border: "1px solid #555", backgroundColor: "#fafafa", color: "#111", overflow: "auto", flex: 1, minHeight: 300, height: "68vh"};
const HEAD_STYLE = {position: "sticky", top: 0, backgroundColor: "#f0f0f0", fontSize: 12, fontWeight: "bold", padding: "4px 8px", borderRight: "1px solid #ddd", borderBottom: "1px solid #ccc", whiteSpace: "nowrap", textAlign: "center", zIndex: 1, cursor: "pointer"};
const CHANNEL_STYLE = {position: "sticky", left: 0, backgroundColor: "#ececec", fontSize: 12, fontWeight: "bold", padding: "3px 8px", whiteSpace: "nowrap", borderBottom: "1px solid #ddd", zIndex: 1};
const CELL_STYLE = {fontSize: 12, padding: "3px 8px", whiteSpace: "nowrap", textAlign: "center", borderRight: "1px solid #eee", borderBottom: "1px solid #eee"};

/** {dca, label} for each cue a channel is in */
const usage = (show, cue, ch) => {
	for (let d = 1; d <= MAX_DCAS; d++) {
		if (parse_channels(cue[dca_field(d, 'Channels')]).includes(ch)) return {dca: d, label: get_DCA_label(show, cue, d)};
	}
	return null;
}

/**
 * Move Assignments: step through the cues where one channel (e.g. a principal) is assigned
 * and move it to another (an understudy). Per cue: Move (M), Keep (K: drop the source's
 * assignment, keep the destination's), Delete both (D) or Skip (S). Each step is its own undo.
 */
const MoveAssignments = ({show, cues, runEdit, onDone}) => {
	const channels = controlled_channels(show);
	const name = (ch) => default_profile(show, ch)?.name || `Channel ${ch}`;
	const [from, setFrom] = useState(channels[0] ?? 1);
	const [to, setTo] = useState(channels[1] ?? 2);
	const [startKey, setStartKey] = useState(cues[0] ? cue_key(cues[0]) : "");
	const [endKey, setEndKey] = useState(cues.length ? cue_key(cues[cues.length - 1]) : "");
	const [keepLabels, setKeepLabels] = useState(true);
	const [step, setStep] = useState(null);   // index into run, while running
	const [run, setRun] = useState([]);       // cue keys to step through, fixed at Start
	const [log, setLog] = useState([]);

	const todo = useMemo(() => {
		const a = cues.findIndex((c) => cue_key(c) === startKey), b = cues.findIndex((c) => cue_key(c) === endKey);
		return cues.slice(Math.min(a, b), Math.max(a, b) + 1).filter((c) => usage(show, c, from));
	}, [cues, startKey, endKey, from, show]);

	const current = step !== null ? show.cues.find((c) => cue_key(c) === run[step]) ?? null : null;

	const act = async (action) => {
		if (!current) return;
		const where = usage(show, current, from);
		const ops = [];
		if (where && action !== 'skip') {
			const dca = read_dca(show, current, where.dca);
			const others = dca.channels.filter((ch) => ch !== from && ch !== to);
			const move = (src, dst, map) => ({...Object.fromEntries(Object.entries(map).filter(([ch]) => Number(ch) !== src)), ...(map[src] !== undefined ? {[dst]: map[src]} : {})});
			if (action === 'move') {
				ops.push({op: 'set_dca', cue: cue_key(current), dca: where.dca,
					channels: dca.channels.map((ch) => ch === from ? to : ch).filter((ch, i, list) => list.indexOf(ch) === i),
					label: keepLabels ? (dca.label ?? (dca.channels.length === 1 ? get_DCA_label(show, current, where.dca) : null)) : dca.label,
					positions: move(from, to, dca.positions), levels: move(from, to, dca.levels),
					profiles: Object.fromEntries(Object.entries(dca.profiles).filter(([ch]) => Number(ch) !== from))});
			} else if (action === 'keep') {
				ops.push({op: 'set_dca', cue: cue_key(current), dca: where.dca, channels: dca.channels.filter((ch) => ch !== from),
					label: dca.label, positions: dca.positions, profiles: dca.profiles, levels: dca.levels});
			} else if (action === 'delete') {
				ops.push({op: 'set_dca', cue: cue_key(current), dca: where.dca, channels: others,
					label: dca.label, positions: dca.positions, profiles: dca.profiles, levels: dca.levels});
				const dest = usage(show, current, to);
				if (dest && dest.dca !== where.dca) {
					const d2 = read_dca(show, current, dest.dca);
					ops.push({op: 'set_dca', cue: cue_key(current), dca: dest.dca, channels: d2.channels.filter((ch) => ch !== to),
						label: d2.label, positions: d2.positions, profiles: d2.profiles, levels: d2.levels});
				}
			}
		}
		if (ops.length && !(await runEdit(ops, {setup: true}))) return;
		setLog((prev) => [...prev, `Cue ${format_cue_number(current.number, current.point)}: ${action}`]);
		setStep((s) => s + 1 < run.length ? s + 1 : null);
	}

	// M / K / D / S while stepping (⌘Z still undoes)
	useEffect(() => {
		if (step === null) return;
		const keys = {m: 'move', k: 'keep', d: 'delete', s: 'skip'};
		const handle = (e) => { const a = keys[e.key.toLowerCase()]; if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); act(a); } };
		window.addEventListener('keydown', handle, true);
		return () => window.removeEventListener('keydown', handle, true);
	});

	const cueOption = (c) => <option key={cue_key(c)} value={cue_key(c)}>{format_cue_number(c.number, c.point)} {c.name}</option>;

	return (
		<div style={{display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px"}}>
			<div style={{display: "grid", gridTemplateColumns: "auto auto auto auto", gap: "8px 10px", alignItems: "center", justifyContent: "start"}}>
				<label>From channel:</label>
				<select value={from} onChange={(e) => setFrom(Number(e.target.value))} style={INPUT_STYLE} disabled={step !== null}>{channels.map((ch) => <option key={ch} value={ch}>{ch} {name(ch)}</option>)}</select>
				<label>To channel:</label>
				<select value={to} onChange={(e) => setTo(Number(e.target.value))} style={INPUT_STYLE} disabled={step !== null}>{channels.map((ch) => <option key={ch} value={ch}>{ch} {name(ch)}</option>)}</select>
				<label>From cue:</label>
				<select value={startKey} onChange={(e) => setStartKey(e.target.value)} style={{...INPUT_STYLE, maxWidth: 260}} disabled={step !== null}>{cues.map(cueOption)}</select>
				<label>To cue:</label>
				<select value={endKey} onChange={(e) => setEndKey(e.target.value)} style={{...INPUT_STYLE, maxWidth: 260}} disabled={step !== null}>{cues.map(cueOption)}</select>
			</div>
			<label style={{display: "flex", gap: 8, alignItems: "center"}}>
				<input type="checkbox" checked={keepLabels} onChange={(e) => setKeepLabels(e.target.checked)} disabled={step !== null}/>
				Keep the DCA labels (the character's name stays on the DCA after the move)
			</label>
			<div>{from === to ? "Pick two different channels." : `${todo.length} cue${todo.length === 1 ? "" : "s"} with ${name(from)} (${from}) assigned in that range.`}</div>

			{step === null
				? <div style={{display: "flex", gap: 8}}>
					<button style={PRIMARY_BUTTON_STYLE} disabled={!todo.length || from === to} onClick={() => { setLog([]); setRun(todo.map(cue_key)); setStep(0); }}>Start</button>
					<button style={BUTTON_STYLE} onClick={onDone}>Back to the timeline</button>
				</div>
				: current && <div style={{border: "1px solid #555", borderRadius: 6, padding: 12, display: "flex", flexDirection: "column", gap: 10}}>
					<div style={{fontSize: 18}}>
						Cue {format_cue_number(current.number, current.point)} — {current.name} ({step + 1} of {run.length})
					</div>
					<div>
						{name(from)} ({from}) is on DCA {usage(show, current, from)?.dca} "{usage(show, current, from)?.label}"
						{usage(show, current, to) ? `; ${name(to)} (${to}) is on DCA ${usage(show, current, to).dca}` : ""}
					</div>
					<div style={{display: "flex", gap: 8}}>
						<button style={PRIMARY_BUTTON_STYLE} onClick={() => act('move')}>Move (M)</button>
						<button style={BUTTON_STYLE} onClick={() => act('keep')} title={`Remove ${name(from)}'s assignment; ${name(to)} stays as it is`}>Keep (K)</button>
						<button style={BUTTON_STYLE} onClick={() => act('delete')} title="Remove both channels from this cue">Delete (D)</button>
						<button style={BUTTON_STYLE} onClick={() => act('skip')}>Skip (S)</button>
						<button style={BUTTON_STYLE} onClick={() => setStep(null)}>Stop</button>
					</div>
				</div>}
			{log.length ? <div style={{fontSize: 13, opacity: 0.75}}>{log.join(" · ")}{step === null ? " — done" : ""}</div> : null}
			<div style={{fontSize: 13, opacity: 0.7}}>Each step can be undone with ⌘Z. Saving the show to a new file first is a good idea.</div>
		</div>
	);
}

/**
 * @typedef {Object} ChannelUtilisationProps
 * @property {Object} show
 * @property {String | null} activeKey - the active cue
 * @property {Function} runEdit - apply edit ops (for Move Assignments)
 * @property {Function} onSelectCue - called with a cue key (selects it in the cue list)
 * @property {Function} onClose
 */

/**
 * View → Channel Utilisation: a timeline of every channel against every cue, showing the DCA
 * each is on, to check the mic plot and find stray assignments. Opens Move Assignments.
 * @param {ChannelUtilisationProps} props
 */
const ChannelUtilisation = ({show, activeKey, runEdit, onSelectCue, onClose}) => {
	const [moving, setMoving] = useState(false);
	const cues = useMemo(() => [...show.cues].sort((a, b) => cue_value(a) - cue_value(b)), [show]);
	const channels = controlled_channels(show);

	return (
		<Dialog
			title={moving ? "Move Assignments" : `Channel Utilisation`}
			subtitle={moving ? "Move a channel's DCA assignments to another channel (e.g. an understudy), cue by cue" : "Each channel's DCA in every cue. Click a cue to select it in the cue list."}
			width="96vw"
			onCancel={onClose}
			cancelLabel="Close"
			footerLeft={!moving ? <button style={BUTTON_STYLE} onClick={() => setMoving(true)}>Move Assignments…</button> : null}
		>
			{moving
				? <MoveAssignments show={show} cues={cues} runEdit={runEdit} onDone={() => setMoving(false)}/>
				: <div style={GRID_BOX_STYLE}>
					<table style={{borderCollapse: "collapse"}}>
						<thead>
							<tr>
								<th style={{...HEAD_STYLE, left: 0, zIndex: 2, cursor: "default"}}></th>
								{cues.map((c) => (
									<th
										key={cue_key(c)}
										style={{...HEAD_STYLE, color: cue_key(c) === activeKey ? SELECTED_COLOR : "#111"}}
										onClick={() => onSelectCue(cue_key(c))}
										title="Select this cue in the cue list"
									>
										Cue {format_cue_number(c.number, c.point)}<br/>
										<span style={{fontWeight: "bold"}}>{c.name}</span>
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{channels.map((ch, i) => (
								<tr key={ch} style={{backgroundColor: i % 2 ? "#f4f4f4" : "#fff"}}>
									<td style={CHANNEL_STYLE}>{ch}) {default_profile(show, ch)?.name || `Channel ${ch}`}</td>
									{cues.map((c) => {
										const u = usage(show, c, ch);
										return <td key={cue_key(c)} style={{...CELL_STYLE, backgroundColor: cue_key(c) === activeKey ? "#e3edff" : undefined}}>{u ? `${u.label} (${u.dca})` : ""}</td>;
									})}
								</tr>
							))}
						</tbody>
					</table>
				</div>}
		</Dialog>
	);
}

export default ChannelUtilisation;
