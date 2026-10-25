import React, { useMemo, useState } from 'react';

import Dialog, { BUTTON_STYLE, INPUT_STYLE } from './Dialog.jsx';
import { SELECTED_COLOR, themed } from './utils/colors.jsx';
import { parse_map, serialize_map, controlled_channels, default_profile, SETTING_SECTIONS, profile_flags, with_profile_flags } from '../utils/show_edits.js';

const SECTION_NAMES = {gain: "Gain", hpf: "HPF", eq: "EQ", dyn: "Dyn"};
const FLAG_CELL = {width: 46, textAlign: "center", fontSize: 13};

const LIST_BOX_STYLE = {border: `1px solid ${themed('lineStrong')}`, backgroundColor: themed('panel'), overflowY: "auto", height: 400, flexShrink: 0};
const CHANNEL_ROW_STYLE = {padding: "4px 8px", fontSize: 14, opacity: 0.8, borderTop: `1px solid ${themed('line')}`};
const ACTOR_ROW_STYLE = {padding: "2px 8px 2px 40px", display: "flex", alignItems: "center", gap: 8};

/**
 * @typedef {Object} ActorSetupDialogProps
 * @property {Object} show
 * @property {Function} onSave - called with the edit ops to apply
 * @property {Function} onCancel
 */

/**
 * File → Actor Setup: who plays each channel's character. The selected (active) actor's name
 * goes on the channel's scribble strip in Line Checks. Actor groups switch many roles at once
 * (a second cast, an understudy show).
 * @param {ActorSetupDialogProps} props
 */
const ActorSetupDialog = ({show, onSave, onCancel}) => {
	const [actors, setActors] = useState(() => (show.actors ?? []).map((a) => ({...a})));
	const [groups, setGroups] = useState(() => (show.actorGroups ?? []).map((g) => ({...g})));
	const [labels, setLabels] = useState(show.config?.cueZeroActorLabels !== "0");
	const [picked, setPicked] = useState(null);       // {channel} or {actor: index}
	const [groupId, setGroupId] = useState("");
	const [groupName, setGroupName] = useState("");
	// Which sections each channel's default profile stores per actor ("actorParams"), by profile id
	const [actorFlags, setActorFlags] = useState(() => Object.fromEntries((show.profiles ?? []).map((p) => [p.id, profile_flags(p).actor])));
	// Stored StudioLive settings: "owner|section" -> JSON
	const [settings, setSettings] = useState(() => new Map((show.channelSettings ?? []).map((r) => [`${r.owner}|${r.section}`, r.data])));
	const [message, setMessage] = useState("");

	const channels = useMemo(() => {
		const list = new Set(controlled_channels(show));
		for (const a of actors) list.add(Number(a.channel));
		return [...list].sort((a, b) => a - b).map((ch) => ({ch, name: default_profile(show, ch)?.name || `Channel ${ch}`}));
	}, [show, actors]);

	const actorsOf = (ch) => actors.map((a, index) => ({a, index}))
		.filter(({a}) => Number(a.channel) === ch)
		.sort((x, y) => (Number(x.a.order) - Number(y.a.order)) || ((x.a.id ?? 1e9) - (y.a.id ?? 1e9)));

	const pickedChannel = picked?.channel ?? (picked?.actor !== undefined ? Number(actors[picked.actor]?.channel) : null);

	const update = (index, changes) => setActors((prev) => prev.map((a, i) => i === index ? {...a, ...changes} : a));

	/** One active actor per channel */
	const makeActive = (index) => {
		const ch = Number(actors[index].channel);
		setActors((prev) => prev.map((a, i) => Number(a.channel) === ch ? {...a, active: i === index ? 1 : 0} : a));
	}

	const add = () => {
		if (!pickedChannel) return;
		const existing = actorsOf(pickedChannel);
		const order = existing.length ? Math.max(...existing.map(({a}) => Number(a.order) || 0)) + 1 : 0;
		setActors((prev) => [...prev, {id: null, channel: pickedChannel, name: "New Actor", order, active: existing.length ? 0 : 1}]);
		setPicked({actor: actors.length});
	}

	const remove = () => {
		if (picked?.actor === undefined) return;
		const removed = actors[picked.actor];
		setActors((prev) => {
			const next = prev.filter((_, i) => i !== picked.actor);
			// The channel's next actor takes over if the active one went
			if (Number(removed.active)) {
				const first = next.findIndex((a) => Number(a.channel) === Number(removed.channel));
				if (first >= 0) next[first] = {...next[first], active: 1};
			}
			return next;
		});
		setPicked({channel: Number(removed.channel)});
	}

	/** ↑ / ↓ within the channel */
	const move = (step) => {
		if (picked?.actor === undefined) return;
		const list = actorsOf(Number(actors[picked.actor].channel));
		const at = list.findIndex(({index}) => index === picked.actor);
		const other = list[at + step];
		if (!other) return;
		setActors((prev) => {
			const reordered = list.map(({index}) => index);
			[reordered[at], reordered[at + step]] = [reordered[at + step], reordered[at]];
			const order = new Map(reordered.map((index, i) => [index, i]));
			return prev.map((a, i) => order.has(i) ? {...a, order: order.get(i)} : a);
		});
	}

	/** Load Group: the group's actor becomes active on each of its channels */
	const loadGroup = () => {
		const group = groups.find((g) => String(g.id) === groupId);
		if (!group) return;
		const chosen = parse_map(group.data);
		setActors((prev) => prev.map((a) => {
			const want = chosen.get(Number(a.channel));
			return want === undefined ? a : {...a, active: String(a.id) === want ? 1 : 0};
		}));
	}

	/** Save Group: today's active actors, under a name (replacing a group with that name) */
	const saveGroup = () => {
		const name = groupName.trim();
		if (!name) return;
		const data = serialize_map(new Map(actors.filter((a) => Number(a.active) && a.id !== null).map((a) => [Number(a.channel), String(a.id)])));
		setGroups((prev) => prev.some((g) => g.name === name)
			? prev.map((g) => g.name === name ? {...g, data} : g)
			: [...prev, {id: null, name, data}]);
		setGroupName("");
	}

	/** Store Gain / HPF / EQ / Dyn per actor, for a channel (its default profile) */
	const toggleActorFlag = (ch, section, on) => {
		const profile = default_profile(show, ch);
		if (!profile) return;
		setActorFlags((prev) => {
			const next = new Set(prev[profile.id] ?? []);
			if (on) next.add(section); else next.delete(section);
			return {...prev, [profile.id]: next};
		});
	}

	/** Store from console: the selected actor's ticked sections, from their channel now */
	const storeFromConsole = async () => {
		const actor = actors[picked?.actor];
		if (!actor) return;
		const profile = default_profile(show, Number(actor.channel));
		if (actor.id === null || !profile) { setMessage("Press OK to save the new actor first, then store their settings."); return; }
		const sections = [...(actorFlags[profile.id] ?? [])];
		if (!sections.length) { setMessage(`Tick what's stored per actor for ${profile.name} (Gain, HPF, EQ, Dyn) first.`); return; }
		const result = await window.presonus.captureSettings(Number(actor.channel), sections);
		if (!result.ok) { setMessage(result.error); return; }
		setSettings((prev) => {
			const next = new Map(prev);
			for (const [section, values] of Object.entries(result.settings)) next.set(`actor:${actor.id}:${profile.id}|${section}`, JSON.stringify(values));
			return next;
		});
		setMessage(`Stored ${Object.keys(result.settings).map((x) => SECTION_NAMES[x]).join(", ")} for ${actor.name}.`);
	}

	const stored = (actor, section) => {
		const profile = default_profile(show, Number(actor.channel));
		return profile && settings.has(`actor:${actor.id}:${profile.id}|${section}`);
	}

	const save = () => {
		const ops = [
			{op: 'set_actors', actors: actors.map((a) => ({...a, name: String(a.name ?? "").trim() || "Actor"})), actorGroups: groups},
			{op: 'set_config', values: {cueZeroActorLabels: labels ? "1" : "0"}},
		];
		// Per-actor flags live in the profiles' TheatreMix data
		const profiles = (show.profiles ?? []).map((p) => {
			const flags = profile_flags(p);
			const actor = actorFlags[p.id] ?? flags.actor;
			return [...actor].sort().join() === [...flags.actor].sort().join() ? p : {...p, data: with_profile_flags(p.data, {store: flags.store, actor})};
		});
		if (profiles.some((p, i) => p !== show.profiles[i])) ops.push({op: 'set_profiles', profiles});
		const before = new Map((show.channelSettings ?? []).map((r) => [`${r.owner}|${r.section}`, r.data]));
		for (const key of new Set([...before.keys(), ...settings.keys()])) {
			if (before.get(key) === settings.get(key)) continue;
			const [owner, section] = key.split("|");
			ops.push({op: 'set_channel_settings', owner, section, data: settings.get(key) ?? null});
		}
		onSave(ops);
	}

	return (
		<Dialog title="Actor Setup" width={760} onCancel={onCancel} onSubmit={save}>
			<div style={LIST_BOX_STYLE}>
				<div style={{...CHANNEL_ROW_STYLE, display: "flex", fontSize: 12, opacity: 0.7, position: "sticky", top: 0, backgroundColor: themed('panel'), zIndex: 1}}>
					<span style={{flex: 1}}>Channel / actors</span>
					{SETTING_SECTIONS.map((x) => <span key={x} style={FLAG_CELL}>Store<br/>{SECTION_NAMES[x]}</span>)}
				</div>
				{channels.map(({ch, name}) => [
					<div
						key={`c${ch}`}
						style={{...CHANNEL_ROW_STYLE, display: "flex", alignItems: "center", backgroundColor: picked?.channel === ch ? SELECTED_COLOR : "transparent"}}
						onMouseDown={() => setPicked({channel: ch})}
					>
						<span style={{flex: 1}}>{ch}&nbsp;&nbsp;{name}</span>
						{SETTING_SECTIONS.map((x) => {
							const profile = default_profile(show, ch);
							return <span key={x} style={FLAG_CELL}>
								<input type="checkbox" disabled={!profile} checked={!!profile && (actorFlags[profile.id] ?? new Set()).has(x)} onChange={(e) => toggleActorFlag(ch, x, e.target.checked)} aria-label={`${name}: store ${SECTION_NAMES[x]} per actor`}/>
							</span>;
						})}
					</div>,
					...actorsOf(ch).map(({a, index}) => (
						<div
							key={`a${index}`}
							style={{...ACTOR_ROW_STYLE, backgroundColor: picked?.actor === index ? SELECTED_COLOR : "transparent"}}
							onMouseDown={() => setPicked({actor: index})}
						>
							<input type="radio" name={`active-${ch}`} checked={Number(a.active) === 1} onChange={() => makeActive(index)} aria-label={`${a.name} plays ${name}`} title="Playing tonight"/>
							<input value={a.name ?? ""} onChange={(e) => update(index, {name: e.target.value})} style={{...INPUT_STYLE, padding: "1px 6px", width: 260, fontWeight: Number(a.active) ? "bold" : "normal"}} aria-label={`Actor for channel ${ch}`}/>
							<span style={{flex: 1}}/>
							{SETTING_SECTIONS.map((x) => <span key={x} style={{...FLAG_CELL, visibility: stored(a, x) ? "visible" : "hidden"}} title="Stored for this actor">◆</span>)}
						</div>
					)),
				])}
			</div>

			<div style={{display: "flex", gap: 8, alignItems: "center"}}>
				<button style={BUTTON_STYLE} onClick={add} disabled={!pickedChannel} title="Add an actor to the selected channel">+</button>
				<button style={BUTTON_STYLE} onClick={remove} disabled={picked?.actor === undefined} title="Remove the selected actor">−</button>
				<button style={BUTTON_STYLE} onClick={() => move(-1)} disabled={picked?.actor === undefined} title="Move up">↑</button>
				<button style={BUTTON_STYLE} onClick={() => move(1)} disabled={picked?.actor === undefined} title="Move down">↓</button>
				<button style={BUTTON_STYLE} onClick={storeFromConsole} disabled={picked?.actor === undefined} title="Store the selected actor's ticked sections from their channel on the console now">Store from console</button>
				<span style={{fontSize: 13, opacity: 0.7}}>{message || "The selected actor (●) is the one playing the part."}</span>
			</div>

			<label style={{display: "flex", alignItems: "center", gap: 8}}>
				<input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)}/>
				Show actor names on channel scribble strips in checks cues
			</label>

			<div style={{display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap"}}>
				<select value={groupId} onChange={(e) => setGroupId(e.target.value)} style={INPUT_STYLE} aria-label="Actor group">
					<option value="">Actor group…</option>
					{groups.filter((g) => g.id !== null).map((g) => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
				</select>
				<button style={BUTTON_STYLE} onClick={loadGroup} disabled={!groupId}>Load Group</button>
				<span style={{width: 16}}/>
				<input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name" style={{...INPUT_STYLE, width: 140}} aria-label="New group name"/>
				<button style={BUTTON_STYLE} onClick={saveGroup} disabled={!groupName.trim()}>Save Group</button>
			</div>
		</Dialog>
	);
}

export default ActorSetupDialog;
