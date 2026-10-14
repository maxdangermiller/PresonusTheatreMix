import React, { useEffect, useMemo, useState } from 'react';

import Dialog, { BUTTON_STYLE, INPUT_STYLE } from './Dialog.jsx';
import { SELECTED_COLOR, BORDER_COLOR } from './utils/colors.jsx';
import StoredSettingsView from './StoredSettingsView.jsx';
import { parse_channels, parse_map, serialize_map, SETTING_SECTIONS, profile_flags, with_profile_flags } from '../utils/show_edits.js';

const SECTION_NAMES = {gain: "Gain", hpf: "HPF", eq: "EQ", dyn: "Dyn"};

// A StudioLive 32's inputs, and its DCAs: 8 normally (like TheatreMix), all 24 with the option
const CONSOLE_CHANNELS = 32;
const CONSOLE_DCAS = 8;
const ALL_DCAS = 24;

const TABS = ['Channels & DCAs', 'Levels', 'QLab', 'REAPER', 'Console'];
const ENSEMBLE_CHOICES = ['', 'Male', 'Female'];

const TAB_STYLE = (on) => ({...BUTTON_STYLE, borderRadius: 0, padding: "4px 14px", fontSize: 14, backgroundColor: on ? SELECTED_COLOR : "transparent", borderColor: on ? SELECTED_COLOR : "#6c757d"});
// The channel table fills the window's spare height and is the only thing that scrolls
const TABLE_BOX_STYLE = {border: "1px solid #555", backgroundColor: "#141414", overflowY: "auto", flex: 1, minHeight: 120};
// The other tabs: a column of settings that scrolls on its own if the window is short
const TAB_PAGE_STYLE = {display: "flex", flexDirection: "column", gap: 14, padding: "8px 20px", overflowY: "auto", minHeight: 0};
const ROW_BUTTON_STYLE = {...BUTTON_STYLE, whiteSpace: "nowrap", fontSize: 14, padding: "0.3rem 0.6rem"};
// Never squeezed out of view: it takes up to half the tab and scrolls past that
const STORED_BOX_STYLE = {border: "1px solid #444", borderRadius: 4, padding: "8px 10px", flexShrink: 0, maxHeight: "50%", overflow: "auto"};
const HEAD_STYLE = {textAlign: "left", fontWeight: "normal", fontSize: 13, color: "#b5b5b5", padding: "4px 6px", borderBottom: "1px solid #444", position: "sticky", top: 0, backgroundColor: "#141414", zIndex: 1};
const CELL_STYLE = {padding: "1px 4px", fontSize: 14};
const SMALL_INPUT = {...INPUT_STYLE, padding: "1px 4px", fontSize: 14, width: "100%", boxSizing: "border-box"};
const NOTE_STYLE = {fontSize: 13, opacity: 0.7, margin: "2px 0 0 26px"};

/** A labelled checkbox with an optional explanation under it */
const Check = ({checked, onChange, children, note, disabled}) => (
	<div>
		<label style={{display: "flex", alignItems: "center", gap: 8, opacity: disabled ? 0.5 : 1}}>
			<input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}/>
			{children}
		</label>
		{note ? <div style={NOTE_STYLE}>{note}</div> : null}
	</div>
);

/**
 * @typedef {Object} ShowSetupDialogProps
 * @property {Object} show
 * @property {Function} onSave - called with the edit ops to apply
 * @property {Function} onCancel
 */

/**
 * File → Show Setup: the show's channels (names, console labels, profiles), DCAs and settings
 * @param {ShowSetupDialogProps} props
 */
/**
 * Nothing stored yet: the line's settings on the console now, so there's still something to see
 * @param {{channel: Number}} props
 */
const LiveSettings = ({channel}) => {
	const [live, setLive] = useState(null);
	useEffect(() => {
		setLive(null);
		let current = true;
		window.presonus.readSettings(channel).then((result) => { if (current) setLive(result); });
		return () => { current = false; };
	}, [channel]);
	if (!live) return <div style={{fontSize: 13, opacity: 0.6}}>Reading the console…</div>;
	if (!live.ok) return <div style={{fontSize: 13, opacity: 0.6}}>Nothing stored yet, and the console isn't connected to show what's on it now.</div>;
	return <>
		<div style={{fontSize: 13, color: "#ffb86b", marginBottom: 6}}>Nothing stored yet. This is line {channel} on the console now; Store from console saves it.</div>
		<StoredSettingsView settings={live.settings}/>
	</>;
}

const ShowSetupDialog = ({show, onSave, onCancel}) => {
	const [tab, setTab] = useState(TABS[0]);
	const [config, setConfig] = useState(() => ({...show.config}));
	// Console tab → "Use all 24 DCAs" (this app's console setup, not TheatreMix's settings)
	const [allDcas, setAllDcas] = useState(show.consoleSetup?.allDcas === "1");
	const [profiles, setProfiles] = useState(() => (show.profiles ?? []).map((p) => ({...p})));
	const [picked, setPicked] = useState(null);   // {channel} or {profile: index}
	// Stored StudioLive settings: "owner|section" -> JSON (this app's channelSettings table)
	const [settings, setSettings] = useState(() => new Map((show.channelSettings ?? []).map((r) => [`${r.owner}|${r.section}`, r.data])));
	const [storeMessage, setStoreMessage] = useState("");
	// Whose stored settings the panel shows: "profile:<id>" or "actor:<id>:<profile id>"
	const [viewOwner, setViewOwner] = useState(null);

	const set = (param, value) => setConfig((prev) => ({...prev, [param]: value}));
	const flag = (param) => config[param] === "1";
	const setFlag = (param) => (on) => set(param, on ? "1" : "0");

	const controlled = useMemo(() => new Set(parse_channels(config.channels)), [config.channels]);
	const dcas = useMemo(() => new Set(parse_channels(config.dcas)), [config.dcas]);
	const toggleIn = (param, set_, n, on) => {
		const next = new Set(set_);
		if (on) next.add(n); else next.delete(n);
		set(param, [...next].sort((a, b) => a - b).join(","));
	}

	// Male / Female ensembles: which one each channel is in
	const [ensembleOf, setEnsembleOf] = useState(() => {
		const map = {};
		for (const name of ['Male', 'Female']) {
			const e = (show.ensembles ?? []).find((x) => x.name === name);
			for (const ch of parse_channels(e?.channels)) map[ch] = name;
		}
		return map;
	});

	const channelCount = Math.max(CONSOLE_CHANNELS, ...profiles.map((p) => Number(p.channel)));
	const channels = Array.from({length: channelCount}, (_, i) => i + 1);
	const defaultIndex = (ch) => {
		const i = profiles.findIndex((p) => Number(p.channel) === ch && Number(p.default) === 1);
		return i >= 0 ? i : profiles.findIndex((p) => Number(p.channel) === ch);
	}

	const updateProfile = (index, changes) => setProfiles((prev) => prev.map((p, i) => i === index ? {...p, ...changes} : p));

	/** Typing a name / label for a channel with no profile yet makes its default profile */
	const editDefault = (ch, changes) => {
		const index = defaultIndex(ch);
		if (index >= 0) updateProfile(index, changes);
		else setProfiles((prev) => [...prev, {id: null, channel: ch, name: `Channel ${ch}`, label: null, default: 1, data: "", ...changes}]);
	}

	/** + : another profile for the selected channel */
	const addProfile = () => {
		const ch = picked?.channel ?? (picked?.profile !== undefined ? Number(profiles[picked.profile].channel) : null);
		if (!ch) return;
		const count = profiles.filter((p) => Number(p.channel) === ch).length;
		setProfiles((prev) => [...prev, {id: null, channel: ch, name: `Profile ${count + 1}`, label: null, default: 0, data: ""}]);
	}

	/** Store Gain / HPF / EQ / Dyn checkbox for a profile */
	const setStoreFlag = (index, section, on) => {
		const flags = profile_flags(profiles[index]);
		if (on) flags.store.add(section); else flags.store.delete(section);
		updateProfile(index, {data: with_profile_flags(profiles[index].data, flags)});
	}

	/** The selected profile (a channel row means its default profile), as an index into profiles */
	const pickedProfile = () => picked?.profile ?? (picked?.channel !== undefined ? defaultIndex(picked.channel) : -1);

	/** Store from console: the selected profile's checked sections, from its channel now */
	const storeFromConsole = async () => {
		const index = pickedProfile();
		const profile = profiles[index];
		if (!profile) return;
		if (profile.id === null) { setStoreMessage("Press OK to save the new profile first, then store its settings."); return; }
		const sections = [...profile_flags(profile).store];
		if (!sections.length) { setStoreMessage(`Tick what ${profile.name} stores (Gain, HPF, EQ, Dyn) first.`); return; }
		const result = await window.presonus.captureSettings(Number(profile.channel), sections);
		if (!result.ok) { setStoreMessage(result.error); return; }
		setSettings((prev) => {
			const next = new Map(prev);
			for (const [section, values] of Object.entries(result.settings)) next.set(`profile:${profile.id}|${section}`, JSON.stringify(values));
			return next;
		});
		setStoreMessage(`Stored ${Object.keys(result.settings).map((x) => SECTION_NAMES[x]).join(", ")} for ${profile.name} from channel ${profile.channel}.`);
	}

	const clearStored = () => {
		const profile = profiles[pickedProfile()];
		if (!profile) return;
		setSettings((prev) => new Map([...prev].filter(([key]) => !key.startsWith(`profile:${profile.id}|`))));
		setStoreMessage(`Cleared ${profile.name}'s stored settings.`);
	}

	/** Stored settings for an owner, parsed: section -> {param: value} */
	const storedFor = (owner) => Object.fromEntries([...settings]
		.filter(([key]) => key.startsWith(`${owner}|`))
		.map(([key, data]) => { try { return [key.split("|")[1], JSON.parse(data)]; } catch { return [key.split("|")[1], {}]; } }));

	/** The panel under the table: the selected character's stored settings (or an actor's) */
	const storedPanel = () => {
		const profile = profiles[pickedProfile()];
		if (!profile) return <div style={{fontSize: 13, opacity: 0.6}}>Select a character to see its stored gain, HPF, EQ and dynamics.</div>;
		const actorOwners = [...new Set([...settings.keys()].map((k) => k.split("|")[0]).filter((o) => o.startsWith("actor:") && o.endsWith(`:${profile.id}`)))];
		const owner = viewOwner && (viewOwner === `profile:${profile.id}` || actorOwners.includes(viewOwner)) ? viewOwner : `profile:${profile.id}`;
		const actorName = (o) => show.actors?.find((a) => String(a.id) === o.split(":")[1])?.name ?? "Actor";
		return <>
			<div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 14}}>
				<b>{profile.name || `Channel ${profile.channel}`}</b>
				{actorOwners.length ? (
					<select value={owner} onChange={(e) => setViewOwner(e.target.value)} style={{...INPUT_STYLE, padding: "1px 4px", fontSize: 13}} aria-label="Whose stored settings">
						<option value={`profile:${profile.id}`}>Character's settings</option>
						{actorOwners.map((o) => <option key={o} value={o}>{actorName(o)}'s settings</option>)}
					</select>
				) : null}
			</div>
			{Object.keys(storedFor(owner)).length
				? <StoredSettingsView settings={storedFor(owner)}/>
				: <LiveSettings channel={Number(profile.channel)}/>}
		</>;
	}

	/** Store columns for a profile row: the checkbox, and ◆ when values are stored */
	const storeCells = (index) => SETTING_SECTIONS.map((section) => {
		const p = profiles[index];
		return (
			<td key={section} style={{...CELL_STYLE, textAlign: "center", whiteSpace: "nowrap"}}>
				<input type="checkbox" checked={profile_flags(p).store.has(section)} onChange={(e) => setStoreFlag(index, section, e.target.checked)} aria-label={`${p.name} stores ${SECTION_NAMES[section]}`}/>
				<span style={{fontSize: 11, marginLeft: 2, visibility: settings.has(`profile:${p.id}|${section}`) ? "visible" : "hidden"}} title="Stored">◆</span>
			</td>
		);
	});

	/** − : remove the selected (non-default) profile */
	const removeProfile = () => {
		if (picked?.profile === undefined) return;
		setProfiles((prev) => prev.filter((_, i) => i !== picked.profile));
		setPicked(null);
	}

	// Backup channels: main -> backup ("backupChannels" is stored "backup=main", like TheatreMix)
	const backups = useMemo(() => new Map([...parse_map(config.backupChannels)].map(([backup, main]) => [Number(main), Number(backup)])), [config.backupChannels]);
	const spare = Number(config.spareBackup) || 0;
	const setBackup = (main, backup) => {
		const next = new Map(backups);
		if (backup) next.set(main, backup); else next.delete(main);
		set('backupChannels', serialize_map(new Map([...next].map(([m, b]) => [b, String(m)]))));
	}
	/** Channels free to be a backup for `main`: not controlled, not the spare, not another channel's backup */
	const backupChoices = (main) => channels.filter((ch) => !controlled.has(ch) && ch !== spare
		&& ![...backups].some(([m, b]) => b === ch && m !== main));

	const save = () => {
		// Without all 24 DCAs, only DCAs 1-8 can be controlled
		const values = allDcas ? config : {...config, dcas: parse_channels(config.dcas).filter((d) => d <= CONSOLE_DCAS).join(",")};
		const ops = [{op: 'set_config', values}];
		if (allDcas !== (show.consoleSetup?.allDcas === "1")) ops.push({op: 'set_console_setup', values: {allDcas: allDcas ? "1" : null}});
		if (JSON.stringify(profiles) !== JSON.stringify(show.profiles)) ops.push({op: 'set_profiles', profiles});

		// Male / Female ensembles from the channel table
		const ensembles = (show.ensembles ?? []).map((e) => ({...e}));
		let changed = false;
		for (const name of ['Male', 'Female']) {
			const list = channels.filter((ch) => ensembleOf[ch] === name);
			let e = ensembles.find((x) => x.name === name);
			if (!e && list.length) { e = {id: null, name, channels: "", channelProfiles: ""}; ensembles.push(e); }
			if (e && e.channels !== list.join(",")) {
				e.channels = list.join(",");
				e.channelProfiles = serialize_map(new Map([...parse_map(e.channelProfiles)].filter(([ch]) => list.includes(ch))));
				changed = true;
			}
		}
		if (changed) ops.push({op: 'set_ensembles', ensembles});

		// Stored settings that changed
		const before = new Map((show.channelSettings ?? []).map((r) => [`${r.owner}|${r.section}`, r.data]));
		for (const key of new Set([...before.keys(), ...settings.keys()])) {
			if (before.get(key) === settings.get(key)) continue;
			const [owner, section] = key.split("|");
			ops.push({op: 'set_channel_settings', owner, section, data: settings.get(key) ?? null});
		}
		onSave(ops);
	}

	const isPicked = (p) => (p.channel !== undefined && picked?.channel === p.channel) || (p.profile !== undefined && picked?.profile === p.profile);

	return (
		<Dialog
			title="Show Setup"
			width={1020}
			fill
			onCancel={onCancel}
			onSubmit={save}
		>
			<div style={{display: "flex", justifyContent: "center"}} role="tablist">
				{TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} style={TAB_STYLE(tab === t)} onClick={() => setTab(t)}>{t}</button>)}
			</div>

			{tab === 'Channels & DCAs' && <>
				<div style={{display: "grid", gridTemplateColumns: "auto 300px", gap: "8px 10px", alignItems: "center", justifyContent: "center"}}>
					<label htmlFor="designer">Designer:</label>
					<input id="designer" value={config.designer ?? ""} onChange={(e) => set('designer', e.target.value)} style={INPUT_STYLE}/>
					<label htmlFor="venue">Venue:</label>
					<input id="venue" value={config.venue ?? ""} onChange={(e) => set('venue', e.target.value)} style={INPUT_STYLE}/>
				</div>

				<div style={{display: "flex", alignItems: "center", gap: 12, justifyContent: "center", flexWrap: "wrap"}}>
					<span>DCAs to control:</span>
					{Array.from({length: allDcas ? ALL_DCAS : 12}, (_, i) => i + 1).map((n) => (
						<label key={n} style={{display: "flex", gap: 4, alignItems: "center", opacity: n > (allDcas ? ALL_DCAS : CONSOLE_DCAS) ? 0.4 : 1}}>
							<input type="checkbox" checked={dcas.has(n)} disabled={n > (allDcas ? ALL_DCAS : CONSOLE_DCAS)} onChange={(e) => toggleIn('dcas', dcas, n, e.target.checked)}/>
							{n}
						</label>
					))}
				</div>

				<div style={TABLE_BOX_STYLE}>
					<table style={{width: "100%", borderCollapse: "collapse"}}>
						<thead>
							<tr>
								<th style={{...HEAD_STYLE, width: 70}}>Channel</th>
								<th style={HEAD_STYLE}>Name</th>
								<th style={HEAD_STYLE}>Console Label</th>
								{SETTING_SECTIONS.map((x) => <th key={x} style={{...HEAD_STYLE, width: 52, textAlign: "center"}}>Store<br/>{SECTION_NAMES[x]}</th>)}
								<th style={{...HEAD_STYLE, width: 110}}>Ensemble</th>
								<th style={{...HEAD_STYLE, width: 90}}>Backup</th>
							</tr>
						</thead>
						<tbody>
							{channels.map((ch) => {
								const di = defaultIndex(ch);
								const def = di >= 0 ? profiles[di] : null;
								const alternates = profiles.map((p, i) => ({p, i})).filter(({p, i}) => Number(p.channel) === ch && i !== di);
								return [
									<tr key={`c${ch}`} style={{backgroundColor: isPicked({channel: ch}) ? SELECTED_COLOR : "transparent"}} onMouseDown={() => setPicked({channel: ch})}>
										<td style={{...CELL_STYLE, whiteSpace: "nowrap"}}>
											<input type="checkbox" checked={controlled.has(ch)} onChange={(e) => toggleIn('channels', controlled, ch, e.target.checked)} aria-label={`Control channel ${ch}`}/>
											{" "}{ch}
										</td>
										<td style={CELL_STYLE}><input style={SMALL_INPUT} value={def?.name ?? ""} placeholder={`Channel ${ch}`} onChange={(e) => editDefault(ch, {name: e.target.value})} aria-label={`Channel ${ch} name`}/></td>
										<td style={CELL_STYLE}><input style={SMALL_INPUT} value={def?.label ?? ""} placeholder="(the name)" onChange={(e) => editDefault(ch, {label: e.target.value || null})} aria-label={`Channel ${ch} console label`}/></td>
										{di >= 0 ? storeCells(di) : SETTING_SECTIONS.map((x) => <td key={x}/>)}
										<td style={CELL_STYLE}>
											<select style={SMALL_INPUT} value={ensembleOf[ch] ?? ""} onChange={(e) => setEnsembleOf((prev) => ({...prev, [ch]: e.target.value}))} aria-label={`Channel ${ch} ensemble`}>
												{ENSEMBLE_CHOICES.map((c) => <option key={c} value={c}>{c || "-"}</option>)}
											</select>
										</td>
										<td style={CELL_STYLE}>
											{controlled.has(ch)
												? <select style={SMALL_INPUT} value={backups.get(ch) ?? ""} onChange={(e) => setBackup(ch, Number(e.target.value) || 0)} aria-label={`Channel ${ch} backup`}>
													<option value="">-</option>
													{backupChoices(ch).map((b) => <option key={b} value={b}>Ch {b}</option>)}
												</select>
												: null}
										</td>
									</tr>,
									...alternates.map(({p, i}) => (
										<tr key={`p${i}`} style={{backgroundColor: isPicked({profile: i}) ? SELECTED_COLOR : "transparent"}} onMouseDown={() => setPicked({profile: i})}>
											<td style={{...CELL_STYLE, textAlign: "right", opacity: 0.6}}>└</td>
											<td style={CELL_STYLE}><input style={SMALL_INPUT} value={p.name ?? ""} onChange={(e) => updateProfile(i, {name: e.target.value})} aria-label={`Channel ${ch} profile name`}/></td>
											<td style={CELL_STYLE}><input style={SMALL_INPUT} value={p.label ?? ""} placeholder="(the name)" onChange={(e) => updateProfile(i, {label: e.target.value || null})} aria-label={`Channel ${ch} profile label`}/></td>
											{storeCells(i)}
											<td/>
											<td/>
										</tr>
									)),
								];
							})}
						</tbody>
					</table>
				</div>
				<div style={{display: "flex", gap: 8, alignItems: "center", flexShrink: 0, flexWrap: "wrap"}}>
					<button style={ROW_BUTTON_STYLE} onClick={addProfile} disabled={!picked} title="Add another character (profile) to the selected line">+ Character</button>
					<button style={ROW_BUTTON_STYLE} onClick={removeProfile} disabled={picked?.profile === undefined} title="Remove the selected profile">−</button>
					<button style={ROW_BUTTON_STYLE} onClick={storeFromConsole} disabled={!picked} title="Store the selected profile's ticked sections from its channel on the console now">Store from console</button>
					<button style={ROW_BUTTON_STYLE} onClick={clearStored} disabled={!picked} title="Forget the selected profile's stored settings">Clear stored</button>
					<span style={{fontSize: 13, opacity: 0.7, flex: "1 1 240px", minWidth: 0}}>{storeMessage || "Ticked Store sections (◆ stored) go on the console when a cue uses the character."}</span>
					<label style={{marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap"}}>
						Spare backup channel:
						<select value={spare || ""} onChange={(e) => set('spareBackup', e.target.value || "0")} style={INPUT_STYLE}>
							<option value="">-</option>
							{channels.filter((ch) => !controlled.has(ch) && ![...backups.values()].includes(ch)).map((ch) => <option key={ch} value={ch}>Channel {ch}</option>)}
						</select>
					</label>
				</div>
				<div style={STORED_BOX_STYLE} aria-label="Stored settings">{storedPanel()}</div>
			</>}

			{tab === 'Levels' && <div style={TAB_PAGE_STYLE}>
				<Check checked={flag('channelLevels')} onChange={setFlag('channelLevels')}
					note="Lets channels have level offsets programmed into cues (Assign → Offset), to balance a big ensemble DCA or a channel that moves between lead and ensemble roles. A line's fader goes to 0 dB when it joins a DCA; with this on, to 0 dB plus its offset. Unchecking keeps the offsets in the cues without using them.">
					Store level offsets
				</Check>
				<Check checked={flag('cueZeroResetLevels')} onChange={setFlag('cueZeroResetLevels')}>
					Force all faders to 0 dB in the Line Checks cue
				</Check>
			</div>}

			{tab === 'QLab' && <div style={TAB_PAGE_STYLE}>
				<Check checked={flag('qLabCues')} onChange={setFlag('qLabCues')}
					note="Fires a QLab cue with each cue that has one (the QLab column). Unchecking keeps the QLab cue numbers in the cues.">
					Recall QLab cues
				</Check>
				<Check checked={flag('qLabSuppressBack')} onChange={setFlag('qLabSuppressBack')} disabled={!flag('qLabCues')}>
					Suppress QLab cue recall on the Back button
				</Check>
				<label style={{display: "flex", alignItems: "center", gap: 8}}>
					QLab OSC passcode:
					<input value={config.qLabPasscode ?? ""} onChange={(e) => set('qLabPasscode', e.target.value)} style={{...INPUT_STYLE, width: 90}}/>
				</label>
			</div>}

			{tab === 'REAPER' && <div style={TAB_PAGE_STYLE}>
				<Check checked={flag('dawRemote')} onChange={setFlag('dawRemote')}
					note="While REAPER is recording, each cue fired drops a marker there. While it's stopped, firing a cue moves REAPER to that cue's marker, less the pre-roll: handy for practising sections of the show against a recording (virtual soundcheck).">
					Link to REAPER
				</Check>
				<label style={{display: "flex", alignItems: "center", gap: 8, opacity: flag('dawRemote') ? 1 : 0.5}}>
					REAPER IP address:
					<input value={config.dawIP ?? "127.0.0.1"} onChange={(e) => set('dawIP', e.target.value.trim())} disabled={!flag('dawRemote')} style={{...INPUT_STYLE, width: 140}}/>
				</label>
				<label style={{display: "flex", alignItems: "center", gap: 8, opacity: flag('dawRemote') ? 1 : 0.5}}>
					Marker pre-roll:
					<input type="number" min={0} max={60} step={1} value={config.dawPreRoll ?? "0"} onChange={(e) => set('dawPreRoll', e.target.value)} disabled={!flag('dawRemote')} style={{...INPUT_STYLE, width: 60}}/>
					seconds
				</label>
				<div style={{fontSize: 13, opacity: 0.75, lineHeight: 1.5}}>
					In REAPER: Preferences → Control/OSC/web → Add → OSC (Default pattern). Mode: Local port, local listen
					port 8000, device IP: this computer (127.0.0.1 if it's the same one), device port 9000.
				</div>
			</div>}

			{tab === 'Console' && <div style={TAB_PAGE_STYLE}>
				<div>Console model: <b>PreSonus StudioLive 32 Series III</b></div>
				<Check checked={allDcas} onChange={setAllDcas}
					note="The StudioLive has 24 DCAs; normally a show uses 8, like TheatreMix. With this on, Channels & DCAs → DCAs to control goes up to 24, and the cue list gets a column for each. DCAs 13-24 are saved in the .tmixp (TheatreMix ignores them).">
					Use all 24 DCAs
				</Check>
				<Check checked={config.consoleMuteDCAUnassign !== "0"} onChange={setFlag('consoleMuteDCAUnassign')}
					note="Only lines on one of the cue's DCAs come through.">
					Mute controlled channels that aren't on a DCA
				</Check>
				<Check checked={config.enableChannelMonitoring !== "0"} onChange={setFlag('enableChannelMonitoring')}
					note="Lines go blue when silent and red when nearly clipping.">
					Channel monitoring
				</Check>
				<Check checked={config.activeChannelHighlight !== "0"} onChange={setFlag('activeChannelHighlight')} disabled={config.enableChannelMonitoring === "0"}>
					Highlight channels in the current cue's DCAs (yellow)
				</Check>
				<Check checked={flag('dimDCAFaders')} onChange={setFlag('dimDCAFaders')}
					note="A DCA whose fader is down shows a dimmer color.">
					Dim DCA faders
				</Check>
				<Check checked={flag('dimDCAFadersSuppressColours')} onChange={setFlag('dimDCAFadersSuppressColours')} disabled={!flag('dimDCAFaders')}>
					Dimmed DCAs are dim blue instead of a dim color
				</Check>
				<Check checked={!flag('suppressDCAMuteBackupSwitch')} onChange={(on) => set('suppressDCAMuteBackupSwitch', on ? "0" : "1")}
					note="Pressing a DCA's mute button on the console switches its channels that have a backup (Show Setup → Backup) to the backup, and back.">
					DCA mute buttons switch to backup channels
				</Check>
			</div>}

			<div style={{borderTop: "1px solid " + BORDER_COLOR}}/>
		</Dialog>
	);
}

export default ShowSetupDialog;
