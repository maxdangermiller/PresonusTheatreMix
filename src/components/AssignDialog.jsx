import React, { useEffect, useMemo, useState } from 'react';

import Dialog, { BUTTON_STYLE, INPUT_STYLE } from './Dialog.jsx';
import { SELECTED_COLOR, BORDER_COLOR } from './utils/colors.jsx';
import {
	MIN_OFFSET, MAX_OFFSET, read_dca, cue_channel_dcas, default_position, default_profile, ensemble_channels,
} from '../utils/show_edits.js';
import { MIN_DCA_LEVEL, MAX_DCA_LEVEL, clamp_dca_level } from '../utils/dca_levels.js';
import { format_cue_number } from '../utils/cue_number.js';

const LIST_STYLE = {
	border: "1px solid #555",
	backgroundColor: "#141414",
	overflowY: "auto",
	height: 320,
	fontSize: 15,
}

const ROW_STYLE = {padding: "3px 8px", cursor: "default", whiteSpace: "nowrap", userSelect: "none"}

const TABLE_HEAD_STYLE = {textAlign: "left", fontWeight: "normal", fontSize: 13, opacity: 0.75, padding: "4px 6px", borderBottom: "1px solid #444", position: "sticky", top: 0, backgroundColor: "#141414"}

const COLUMN_STYLE = {display: "flex", flexDirection: "column", gap: "8px"}

/**
 * @typedef {Object} AssignDialogProps
 * @property {Object} show
 * @property {Object} cue
 * @property {Number} dca
 * @property {Function} onSave - called with {channels, label, positions, profiles, levels, dcaLevel, offsetsOn}
 * @property {Function} onCancel
 */

/**
 * Edit → Assign... (⌘E, or double-click a DCA cell): which channels a DCA has in a cue, with
 * each channel's profile, position and level offset, and the DCA's label and level
 * @param {AssignDialogProps} props
 */
const AssignDialog = ({show, cue, dca, onSave, onCancel}) => {
	const initial = useMemo(() => read_dca(show, cue, dca), [show, cue, dca]);
	const first_position = default_position(show);

	const [label, setLabel] = useState(initial.label ?? "");
	// {ch, profile (id, or null for the default), position (id), offset (dB)}
	// Listed in channel order, like TheatreMix
	const [items, setItems] = useState(() => [...initial.channels].sort((a, b) => a - b).map((ch) => ({
		ch,
		profile: initial.profiles[ch] ?? null,
		position: initial.positions[ch] ?? first_position,
		offset: initial.levels[ch] ?? 0,
	})));
	const [dcaLevel, setDcaLevel] = useState(initial.dcaLevel);
	const [leftPick, setLeftPick] = useState(null);     // {ch, profile}
	const [rightPick, setRightPick] = useState(null);   // ch
	const [ensembleId, setEnsembleId] = useState("");
	// Show Setup → Levels "Store level offsets": offsets only move faders when it's on
	const [offsetsOn, setOffsetsOn] = useState(show.config?.channelLevels === "1");
	// The console's line faders, when this is the active cue: shown where they've been moved
	const [console_levels, setConsoleLevels] = useState(null);

	useEffect(() => {
		let current = true;
		const read = () => window.presonus.getLineLevels?.().then((result) => {
			if (current) setConsoleLevels(result?.connected && result.cue === `${Number(cue.number)}.${Number(cue.point)}` ? result.lines : null);
		});
		read();
		const timer = setInterval(read, 1000);
		return () => { current = false; clearInterval(timer); };
	}, [cue]);

	const positions = show.positions ?? [];
	const others = useMemo(() => cue_channel_dcas(cue), [cue]);

	// Every channel with its default profile first and its other profiles under it
	const channels = useMemo(() => {
		const byChannel = new Map();
		for (const p of show.profiles ?? []) {
			const ch = Number(p.channel);
			if (!byChannel.has(ch)) byChannel.set(ch, []);
			byChannel.get(ch).push(p);
		}
		return [...byChannel.entries()].sort((a, b) => a[0] - b[0]).map(([ch, profiles]) => {
			const def = default_profile(show, ch);
			return {ch, def, alternates: profiles.filter((p) => p !== def)};
		});
	}, [show]);

	const profileName = (ch, id) => {
		const p = id === null ? default_profile(show, ch) : show.profiles.find((x) => x.id === id);
		return p?.name || p?.label || `Channel ${ch}`;
	}

	const assign = (ch, profile) => {
		setItems((prev) => prev.some((i) => i.ch === ch)
			? prev.map((i) => i.ch === ch ? {...i, profile} : i)
			: [...prev, {ch, profile, position: first_position, offset: 0}].sort((a, b) => a.ch - b.ch));
		setRightPick(ch);
	}

	const remove = (ch) => {
		setItems((prev) => prev.filter((i) => i.ch !== ch));
		setRightPick(null);
	}

	const update = (ch, changes) => setItems((prev) => prev.map((i) => i.ch === ch ? {...i, ...changes} : i));

	// Ensemble: Assign replaces the DCA's channels, Merge adds to them
	const useEnsemble = (merge) => {
		const ensemble = show.ensembles.find((e) => String(e.id) === ensembleId);
		if (!ensemble) return;
		const {channels: list, profiles} = ensemble_channels(ensemble);
		setItems((prev) => {
			const kept = merge ? prev : [];
			const added = list.filter((ch) => !kept.some((i) => i.ch === ch))
				.map((ch) => ({ch, profile: profiles[ch] ?? null, position: first_position, offset: 0}));
			return [...kept, ...added].sort((a, b) => a.ch - b.ch);
		});
		if (!merge || !label) setLabel(ensemble.name);
	}

	const save = () => onSave({
		channels: items.map((i) => i.ch),
		label: label.trim() || null,
		positions: Object.fromEntries(items.map((i) => [i.ch, i.position])),
		profiles: Object.fromEntries(items.map((i) => [i.ch, i.profile])),
		levels: Object.fromEntries(items.map((i) => [i.ch, i.offset])),
		dcaLevel,
		offsetsOn,
	});

	/**
	 * A line's fader on the console, when it isn't where the cue put it (0 dB plus the offset)
	 * @param {{ch: Number, offset: Number}} item
	 * @returns {{db: Number, line: Number} | null}
	 */
	const movedFader = (item) => {
		const level = console_levels?.[item.ch];
		if (!level || level.db === null || level.target === null) return null;
		return Math.abs(level.db - level.target) >= 0.05 ? level : null;
	}
	const fmt = (db) => db <= -80 ? "-∞" : `${db > 0 ? "+" : ""}${db.toFixed(1)}`;

	const autoLabel = items.length > 1 ? "Group" : items.length ? profileName(items[0].ch, items[0].profile) : "";

	const leftRow = (ch, profile, text, indent) => {
		const picked = leftPick?.ch === ch && leftPick?.profile === profile;
		const elsewhere = others.has(ch) && others.get(ch) !== dca && !items.some((i) => i.ch === ch);
		return (
			<div
				key={`${ch}-${profile}`}
				style={{
					...ROW_STYLE,
					paddingLeft: indent ? 28 : 8,
					fontStyle: elsewhere ? "italic" : "normal",
					opacity: elsewhere ? 0.6 : 1,
					backgroundColor: picked ? SELECTED_COLOR : "transparent",
				}}
				title={elsewhere ? `In DCA ${others.get(ch)} in this cue: assigning moves it here` : undefined}
				onClick={() => setLeftPick({ch, profile})}
				onDoubleClick={() => assign(ch, profile)}
			>
				{text}
			</div>
		);
	}

	return (
		<Dialog
			title={`Assign DCA ${dca}`}
			subtitle={`Cue ${format_cue_number(cue.number, cue.point)} — ${cue.name || "(no text)"}`}
			width={760}
			onCancel={onCancel}
			onSubmit={save}
		>
			<div style={{display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 10px", alignItems: "center"}}>
				<label htmlFor="dca-label">DCA {dca} label:</label>
				<input
					id="dca-label"
					value={label}
					onChange={(e) => setLabel(e.target.value)}
					placeholder={items.length > 1 ? "Group (no label)" : autoLabel ? `${autoLabel} (from the channel)` : "From the channel"}
					style={{...INPUT_STYLE, width: 260}}
					autoFocus
				/>
				<label htmlFor="all-positions">Set all positions:</label>
				<select
					id="all-positions"
					value=""
					onChange={(e) => { const id = Number(e.target.value); setItems((prev) => prev.map((i) => ({...i, position: id}))); }}
					style={{...INPUT_STYLE, width: 272}}
					disabled={!positions.length || !items.length}
				>
					<option value=""></option>
					{positions.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.shortName})</option>)}
				</select>
			</div>

			<div style={{display: "grid", gridTemplateColumns: "230px auto 1fr", gap: "12px", alignItems: "start"}}>
				<div style={COLUMN_STYLE}>
					<div style={LIST_STYLE} role="listbox" aria-label="Channels">
						{channels.map(({ch, def, alternates}) => [
							leftRow(ch, null, `${def?.name || def?.label || "Channel"} (${ch})`, false),
							...alternates.map((p) => leftRow(ch, p.id, p.name || p.label, true)),
						])}
					</div>
					<label style={{fontSize: 14}}>Ensemble:</label>
					<select value={ensembleId} onChange={(e) => setEnsembleId(e.target.value)} style={INPUT_STYLE} aria-label="Ensemble">
						<option value=""></option>
						{(show.ensembles ?? []).map((e) => <option key={e.id} value={String(e.id)}>{e.name}</option>)}
					</select>
				</div>

				<div style={{...COLUMN_STYLE, paddingTop: 120}}>
					<button style={BUTTON_STYLE} disabled={!leftPick} onClick={() => leftPick && assign(leftPick.ch, leftPick.profile)}>Assign →</button>
					<button style={BUTTON_STYLE} disabled={rightPick === null} onClick={() => remove(rightPick)}>← Remove</button>
					<div style={{height: 108}}/>
					<button style={BUTTON_STYLE} disabled={!ensembleId} onClick={() => useEnsemble(false)} title="Replace the DCA's channels with the ensemble">Assign →</button>
					<button style={BUTTON_STYLE} disabled={!ensembleId} onClick={() => useEnsemble(true)} title="Add the ensemble to the DCA's channels">Merge →</button>
				</div>

				<div style={{...LIST_STYLE, height: 392}}>
					<table style={{width: "100%", borderCollapse: "collapse"}}>
						<thead>
							<tr>
								<th style={TABLE_HEAD_STYLE}>Channel</th>
								<th style={TABLE_HEAD_STYLE}>Pos</th>
								<th style={TABLE_HEAD_STYLE}>Offset</th>
								{console_levels ? <th style={TABLE_HEAD_STYLE} title="The line's fader on the console now, when it's been moved from 0 dB plus its offset">Fader</th> : null}
							</tr>
						</thead>
						<tbody>
							{items.map((i) => (
								<tr
									key={i.ch}
									style={{backgroundColor: rightPick === i.ch ? SELECTED_COLOR : "transparent"}}
									onClick={() => setRightPick(i.ch)}
									onDoubleClick={(e) => { if (e.target.tagName === 'TD') remove(i.ch); }}
								>
									<td style={ROW_STYLE}>{profileName(i.ch, i.profile)} ({i.ch})</td>
									<td style={{padding: "2px 4px"}}>
										<select
											value={i.position ?? ""}
											onChange={(e) => update(i.ch, {position: Number(e.target.value)})}
											style={{...INPUT_STYLE, padding: "1px 4px"}}
											disabled={!positions.length}
											aria-label={`Position for channel ${i.ch}`}
										>
											{positions.map((p) => <option key={p.id} value={p.id}>{p.shortName}</option>)}
										</select>
									</td>
									<td style={{padding: "2px 4px", whiteSpace: "nowrap"}}>
										<input
											type="number"
											min={MIN_OFFSET}
											max={MAX_OFFSET}
											step={0.1}
											value={i.offset}
											onChange={(e) => update(i.ch, {offset: Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, Number(e.target.value) || 0))})}
											style={{...INPUT_STYLE, width: 64, padding: "1px 4px", textAlign: "right"}}
											aria-label={`Level offset for channel ${i.ch}`}
										/> dB
									</td>
									{console_levels ? <td style={{padding: "2px 4px", whiteSpace: "nowrap", fontSize: 14}}>
										{(() => {
											const moved = movedFader(i);
											if (!moved) return <span style={{opacity: 0.45}}>{console_levels[i.ch]?.target === null ? "" : "unity"}</span>;
											const offset = Math.round(Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, moved.db)) * 10) / 10;
											return (
												<button
													style={{...BUTTON_STYLE, fontSize: 13, padding: "0 6px", color: "#ffb86b", borderColor: "#ffb86b"}}
													onClick={(e) => { e.stopPropagation(); update(i.ch, {offset}); setOffsetsOn(true); }}
													title={`Channel ${moved.line}'s fader has been moved on the console. Click to keep ${fmt(offset)} dB as this line's offset in this cue.`}
													aria-label={`Keep fader ${fmt(moved.db)} dB as the offset`}
												>{fmt(moved.db)} dB</button>
											);
										})()}
									</td> : null}
								</tr>
							))}
						</tbody>
					</table>
					{!items.length ? <div style={{padding: 10, opacity: 0.6, fontSize: 14}}>No channels: pick one on the left and Assign.</div> : null}
				</div>
			</div>

			<div style={{display: "flex", alignItems: "center", gap: "10px", fontSize: 13}}>
				<label style={{display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap", fontSize: 15}}>
					<input type="checkbox" checked={offsetsOn} onChange={(e) => setOffsetsOn(e.target.checked)}/>
					Apply level offsets
				</label>
				<span style={{opacity: 0.7}}>
					{offsetsOn
						? "Each line's fader goes to 0 dB plus its offset when it joins the DCA (whole show: Show Setup → Levels)."
						: "Off: every line's fader goes to 0 dB when it joins the DCA, and offsets are kept but not used."}
				</span>
			</div>

			<div style={{display: "flex", alignItems: "center", gap: "10px", borderTop: "1px solid " + BORDER_COLOR, paddingTop: 10}}>
				<label style={{display: "flex", alignItems: "center", gap: "6px"}}>
					<input
						type="checkbox"
						checked={dcaLevel !== null}
						onChange={(e) => setDcaLevel(e.target.checked ? 0 : null)}
					/>
					DCA level
				</label>
				<input
					type="number"
					min={MIN_DCA_LEVEL}
					max={MAX_DCA_LEVEL}
					step={0.5}
					value={dcaLevel ?? ""}
					disabled={dcaLevel === null}
					onChange={(e) => setDcaLevel(clamp_dca_level(Number(e.target.value) || 0))}
					style={{...INPUT_STYLE, width: 70, textAlign: "right"}}
					aria-label="DCA level in dB"
				/> dB
				<span style={{fontSize: 13, opacity: 0.7}}>
					{dcaLevel === null
						? "Not set: the fader follows the people on it."
						: "The DCA fader goes here every time this cue fires."}
				</span>
			</div>
		</Dialog>
	);
}

export default AssignDialog;
