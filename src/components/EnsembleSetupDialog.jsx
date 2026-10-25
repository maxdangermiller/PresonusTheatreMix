import React, { useMemo, useState } from 'react';

import Dialog, { BUTTON_STYLE, INPUT_STYLE } from './Dialog.jsx';
import { SELECTED_COLOR, themed } from './utils/colors.jsx';
import { parse_channels, parse_map, serialize_map, controlled_channels, default_profile } from '../utils/show_edits.js';

const GRID_BOX_STYLE = {border: `1px solid ${themed('lineStrong')}`, backgroundColor: themed('panel'), overflow: "auto", maxHeight: 420, flexShrink: 0};
const HEAD_STYLE = {fontWeight: "normal", fontSize: 12, padding: "4px 6px", borderBottom: `1px solid ${themed('line')}`, position: "sticky", top: 0, backgroundColor: themed('panel'), textAlign: "center", whiteSpace: "nowrap", zIndex: 1};
const NAME_HEAD_STYLE = {...HEAD_STYLE, left: 0, zIndex: 2, textAlign: "left", minWidth: 150};
const CELL_STYLE = {padding: "2px 6px", textAlign: "center", borderBottom: `1px solid ${themed('line')}`};
const NAME_CELL_STYLE = {padding: "2px 6px", position: "sticky", left: 0, backgroundColor: themed('panel'), zIndex: 1};

/**
 * @typedef {Object} EnsembleSetupDialogProps
 * @property {Object} show
 * @property {Function} onSave - called with the edit ops to apply
 * @property {Function} onCancel
 */

/**
 * File → Ensemble Setup: groups of channels to assign to a DCA in one go ("RAFIKIS" in a DCA cell).
 * A channel with several profiles can be in an ensemble as a particular one. Like TheatreMix,
 * "All" (every controlled channel) is automatic, and changes only affect new assignments.
 * @param {EnsembleSetupDialogProps} props
 */
const EnsembleSetupDialog = ({show, onSave, onCancel}) => {
	// {id, name, members: {ch: profile id | "default"}}
	const [ensembles, setEnsembles] = useState(() => (show.ensembles ?? []).map((e) => {
		const profiles = parse_map(e.channelProfiles);
		return {id: e.id, name: e.name ?? "", members: Object.fromEntries(parse_channels(e.channels).map((ch) => [ch, profiles.get(ch) ?? "default"]))};
	}));
	const [picked, setPicked] = useState(null);

	const channels = useMemo(() => controlled_channels(show).map((ch) => {
		const def = default_profile(show, ch);
		return {ch, name: def?.name || `Channel ${ch}`, alternates: (show.profiles ?? []).filter((p) => Number(p.channel) === ch && p !== def)};
	}), [show]);

	const setMember = (index, ch, value) => setEnsembles((prev) => prev.map((e, i) => {
		if (i !== index) return e;
		const members = {...e.members};
		if (value === "" || value === false) delete members[ch]; else members[ch] = value === true ? "default" : value;
		return {...e, members};
	}));

	const add = () => {
		setEnsembles((prev) => [...prev, {id: null, name: `Ensemble ${prev.length + 1}`, members: {}}]);
		setPicked(ensembles.length);
	}

	const remove = () => {
		if (picked === null) return;
		setEnsembles((prev) => prev.filter((_, i) => i !== picked));
		setPicked(null);
	}

	const save = () => onSave([{op: 'set_ensembles', ensembles: ensembles.map((e) => {
		const chs = channels.map((c) => c.ch).filter((ch) => e.members[ch] !== undefined)
			.concat(Object.keys(e.members).map(Number).filter((ch) => !channels.some((c) => c.ch === ch)));
		const profiles = new Map(chs.filter((ch) => e.members[ch] !== "default").map((ch) => [ch, String(e.members[ch])]));
		return {id: e.id, name: e.name.trim() || "Ensemble", channels: chs.join(","), channelProfiles: serialize_map(profiles)};
	})}]);

	return (
		<Dialog title="Ensemble Setup" width={980} onCancel={onCancel} onSubmit={save}>
			<div style={GRID_BOX_STYLE}>
				<table style={{borderCollapse: "collapse", fontSize: 14}}>
					<thead>
						<tr>
							<th style={NAME_HEAD_STYLE}>Ensemble</th>
							{channels.map(({ch, name}) => <th key={ch} style={HEAD_STYLE}>{ch}<br/>{name}</th>)}
						</tr>
					</thead>
					<tbody>
						<tr style={{opacity: 0.5}} title="Every controlled channel: automatic">
							<td style={NAME_CELL_STYLE}>All</td>
							{channels.map(({ch}) => <td key={ch} style={CELL_STYLE}><input type="checkbox" checked readOnly disabled/></td>)}
						</tr>
						{ensembles.map((e, index) => (
							<tr key={index} style={{backgroundColor: picked === index ? `color-mix(in srgb, ${SELECTED_COLOR} 45%, transparent)` : "transparent"}} onMouseDown={() => setPicked(index)}>
								<td style={{...NAME_CELL_STYLE, backgroundColor: picked === index ? SELECTED_COLOR : themed('panel')}}>
									<input
										value={e.name}
										onChange={(ev) => setEnsembles((prev) => prev.map((x, i) => i === index ? {...x, name: ev.target.value} : x))}
										style={{...INPUT_STYLE, width: 140, padding: "1px 4px"}}
										aria-label="Ensemble name"
									/>
								</td>
								{channels.map(({ch, name, alternates}) => (
									<td key={ch} style={CELL_STYLE}>
										{alternates.length
											? <select
												value={e.members[ch] === undefined ? "" : String(e.members[ch])}
												onChange={(ev) => setMember(index, ch, ev.target.value)}
												style={{...INPUT_STYLE, padding: "1px 2px", fontSize: 13}}
												aria-label={`${e.name}: channel ${ch}`}
											>
												<option value="">-</option>
												<option value="default">{name}</option>
												{alternates.map((p) => <option key={p.id} value={String(p.id)}>{p.name || p.label}</option>)}
											</select>
											: <input
												type="checkbox"
												checked={e.members[ch] !== undefined}
												onChange={(ev) => setMember(index, ch, ev.target.checked)}
												aria-label={`${e.name}: channel ${ch}`}
											/>}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div style={{display: "flex", gap: 8, alignItems: "center"}}>
				<button style={BUTTON_STYLE} onClick={add} title="Add an ensemble">+</button>
				<button style={BUTTON_STYLE} onClick={remove} disabled={picked === null} title="Remove the selected ensemble">−</button>
				<span style={{fontSize: 13, opacity: 0.7}}>
					Ensemble changes don't modify existing cues; they're only used for new DCA assignments.
					Type an ensemble's name into a DCA cell to add it (⌘Enter replaces what's there).
				</span>
			</div>
		</Dialog>
	);
}

export default EnsembleSetupDialog;
