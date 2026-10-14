/**
 * Show editing, shared by the main process (which applies edits) and the editor (which
 * builds them). Everything works on the plain show object (cues, profiles, ensembles,
 * positions, dcaLevels...) and changes it in place.
 *
 * Cue data is stored the way TheatreMix stores it:
 *   number + point      cue 2.25 is {number: 2, point: 25}; 2.1 is {number: 2, point: 10}
 *   dcaNNChannels       "10,11,12" (NN = 01-12)
 *   dcaNNLabel          the DCA's label, or empty / null to use the first channel's profile
 *   channelPositions    "3=1,5=2": channel = position id (channels left out are in the first position)
 *   channelProfiles     "3=38": channel = profile id (channels left out use their default profile)
 *   channelLevels       "14=9,13=-7": channel = level offset in tenths of a dB (+0.9, -0.7; left out = 0)
 * The per-cue DCA levels (this app's, in .tmixp files) are keyed by "number.point".
 */

import { dca_level_key } from './dca_levels.js';

// TheatreMix's cues have 12 DCA columns; a StudioLive has 24 (Show Setup → "Use all 24 DCAs",
// whose extra columns are added to the .tmixp when it's saved)
const MAX_DCAS = 24;
const TMIX_DCAS = 12;
const DEFAULT_DCAS = 8;

// Level offsets (TheatreMix: -15 to +5 dB per channel per cue, stored in tenths of a dB)
const MIN_OFFSET = -15;
const MAX_OFFSET = 5;
const OFFSET_SCALE = 10;

// Cue fields that can be set directly
const CUE_FIELDS = ['name', 'colour', 'skip', 'qLabCue', 'snippets', 'fxMutes'];

/** "dca01Channels" etc. */
const dca_field = (dca, kind) => `dca${String(dca).padStart(2, "0")}${kind}`;

/** A cue's position in the list in hundredths: 2.25 -> 225 */
const cue_value = (cue) => Number(cue.number) * 100 + Number(cue.point || 0);

/** 225 -> {number: 2, point: 25} */
const from_value = (value) => ({number: Math.floor(value / 100), point: value % 100});

/** "number.point" key, the same one dcaLevels uses */
const cue_key = (cue) => dca_level_key(Number(cue.number), Number(cue.point || 0));

/** "10, 11,12" -> [10, 11, 12] */
const parse_channels = (value) => String(value ?? "")
	.split(",")
	.map((v) => parseInt(v, 10))
	.filter((v) => Number.isInteger(v) && v > 0);

/** "3=38,5=40" -> Map {3 => "38", 5 => "40"} */
const parse_map = (value) => {
	const map = new Map();
	for (const part of String(value ?? "").split(",")) {
		const [ch, val] = part.split("=");
		const n = parseInt(ch, 10);
		if (Number.isInteger(n) && val !== undefined && val.trim() !== "") map.set(n, val.trim());
	}
	return map;
}

/** Map -> "3=38,5=40" (channels in order) */
const serialize_map = (map) => [...map.entries()]
	.sort((a, b) => a[0] - b[0])
	.map(([ch, val]) => `${ch}=${val}`)
	.join(",");

const sorted_cues = (show) => [...show.cues].sort((a, b) => cue_value(a) - cue_value(b));

const find_cue = (show, key) => {
	const cue = show.cues.find((c) => cue_key(c) === key);
	if (!cue) throw new Error(`There is no cue ${key}`);
	return cue;
}

/** The position every channel is in unless a cue says otherwise (TheatreMix: the first one) */
const default_position = (show) => show.positions?.[0]?.id ?? null;

/** A channel's default profile */
const default_profile = (show, ch) =>
	show.profiles?.find((p) => Number(p.channel) === ch && Number(p.default) === 1) ??
	show.profiles?.find((p) => Number(p.channel) === ch) ?? null;

/**
 * Everything about one DCA in a cue
 * @returns {{channels: Number[], label: String | null, positions: Object, profiles: Object, levels: Object, dcaLevel: Number | null}}
 */
const read_dca = (show, cue, dca) => {
	const channels = parse_channels(cue[dca_field(dca, 'Channels')]);
	const positions = parse_map(cue.channelPositions);
	const profiles = parse_map(cue.channelProfiles);
	const levels = parse_map(cue.channelLevels);
	const pick = (map, convert) => Object.fromEntries(channels.filter((ch) => map.has(ch)).map((ch) => [ch, convert(map.get(ch))]));

	return {
		channels,
		label: cue[dca_field(dca, 'Label')] || null,
		positions: pick(positions, Number),
		profiles: pick(profiles, Number),
		levels: pick(levels, (v) => Number(v) / OFFSET_SCALE),
		dcaLevel: show.dcaLevels?.[cue_key(cue)]?.[dca] ?? null,
	};
}

/** Channels in any of a cue's DCAs, and which DCA each is in */
const cue_channel_dcas = (cue) => {
	const where = new Map();
	for (let d = 1; d <= MAX_DCAS; d++) {
		for (const ch of parse_channels(cue[dca_field(d, 'Channels')])) where.set(ch, d);
	}
	return where;
}

/** Drop position / profile / level entries for channels that aren't in any of the cue's DCAs */
const tidy_channel_maps = (cue) => {
	const used = cue_channel_dcas(cue);
	for (const field of ['channelPositions', 'channelProfiles', 'channelLevels']) {
		const map = parse_map(cue[field]);
		for (const ch of [...map.keys()]) if (!used.has(ch)) map.delete(ch);
		cue[field] = serialize_map(map);
	}
}

const set_dca_level_entry = (show, key, dca, level) => {
	show.dcaLevels = show.dcaLevels ?? {};
	if (level === null || level === undefined) {
		if (show.dcaLevels[key]) {
			delete show.dcaLevels[key][dca];
			if (Object.keys(show.dcaLevels[key]).length === 0) delete show.dcaLevels[key];
		}
	} else {
		show.dcaLevels[key] = {...show.dcaLevels[key], [dca]: level};
	}
}

/** Move a cue's DCA levels to a new key (renumbering) */
const move_dca_levels = (show, from, to) => {
	if (!show.dcaLevels?.[from] || from === to) return;
	show.dcaLevels[to] = show.dcaLevels[from];
	delete show.dcaLevels[from];
}

/** A new, empty cue with every column TheatreMix has */
const blank_cue = (show, number, point) => {
	const cue = {};
	// Same columns as the show's other cues (so saving writes the same table)
	for (const field of Object.keys(show.cues[0] ?? {})) cue[field] = null;
	Object.assign(cue, {
		number, point, name: "", colour: 0, skip: 0, qLabCue: "", snippets: "",
		channelPositions: "", channelProfiles: "", channelLevels: "", channelFX: "", fxMutes: "", scenes: "", scenePoints: "",
	});
	for (let d = 1; d <= MAX_DCAS; d++) {
		cue[dca_field(d, 'Channels')] = "";
		cue[dca_field(d, 'Label')] = null;
	}
	return cue;
}

/**
 * Number for a cue placed after `after` (a key, or null for the start of the list): halfway
 * to the next cue, like TheatreMix's Insert Cue (2.1 and 2.2 -> 2.15)
 */
const number_after = (show, after) => {
	const cues = sorted_cues(show);
	const index = after === null ? -1 : cues.findIndex((c) => cue_key(c) === after);
	const a = index >= 0 ? cue_value(cues[index]) : 0;
	const next = cues[index + 1];
	const b = next ? cue_value(next) : Math.floor(a / 100) * 100 + 100;
	const mid = Math.floor((a + b) / 2);
	if (mid <= a) throw new Error(`There's no room for a cue after ${after ?? "Line Checks"}: renumber the cues first`);
	return from_value(mid);
}

/** Give rows without an id the next free one (TheatreMix tables use autoincrement ids) */
const assign_ids = (rows, existing) => {
	let next = Math.max(0, ...existing.map((r) => Number(r.id) || 0), ...rows.map((r) => Number(r.id) || 0)) + 1;
	return rows.map((r) => (r.id === null || r.id === undefined) ? {...r, id: next++} : r);
}

/** Drop "ch=id" entries whose id is in `removed` from a map field */
const drop_ids = (value, removed) => {
	const map = parse_map(value);
	for (const [ch, id] of [...map]) if (removed.has(Number(id))) map.delete(ch);
	return serialize_map(map);
}

const OPS = {
	/** {cue, field, value}: name, colour, skip, qLabCue... */
	set_cue_field(show, {cue, field, value}) {
		if (!CUE_FIELDS.includes(field)) throw new Error(`Can't set ${field}`);
		find_cue(show, cue)[field] = value;
	},

	/** {cue, number, point}: give a cue a new number (it moves to its place in the list) */
	set_cue_number(show, {cue, number, point}) {
		const target = find_cue(show, cue);
		const to = dca_level_key(number, point);
		if (to === cue) return;
		if (number === 0 && point === 0) throw new Error("Cue 0 is Line Checks");
		if (show.cues.some((c) => cue_key(c) === to)) throw new Error(`There's already a cue ${to}`);
		target.number = number;
		target.point = point;
		move_dca_levels(show, cue, to);
		return {key: to};
	},

	/** {after}: an empty cue after this one (null: at the start). Returns the new cue's key */
	insert_cue(show, {after}) {
		const {number, point} = number_after(show, after);
		show.cues.push(blank_cue(show, number, point));
		return {key: dca_level_key(number, point)};
	},

	/** {cue, to_end}: a copy of the cue, right after it or at the end of the list */
	clone_cue(show, {cue, to_end = false}) {
		const source = find_cue(show, cue);
		const cues = sorted_cues(show);
		const {number, point} = to_end
			? {number: Math.floor(cue_value(cues[cues.length - 1]) / 100) + 1, point: 0}
			: number_after(show, cue);
		const copy = {...source, number, point};
		show.cues.push(copy);
		const key = dca_level_key(number, point);
		if (show.dcaLevels?.[cue]) show.dcaLevels[key] = {...show.dcaLevels[cue]};
		return {key};
	},

	/** {cues: [keys]} */
	delete_cues(show, {cues}) {
		const keys = new Set(cues);
		show.cues = show.cues.filter((c) => !keys.has(cue_key(c)));
		for (const key of keys) delete show.dcaLevels?.[key];
	},

	/**
	 * {from, increment}: renumber from this cue to the end, each one `increment` after the last
	 * (TheatreMix's Renumber Cues: increment 1 from 2.1 gives 2.1, 3.1, 4.1...)
	 */
	renumber(show, {from, increment}) {
		const step = Math.round(Number(increment) * 100);
		if (!(step > 0)) throw new Error("The increment has to be more than 0");
		const cues = sorted_cues(show);
		const start = cues.findIndex((c) => cue_key(c) === from);
		if (start < 0) throw new Error(`There is no cue ${from}`);
		const base = cue_value(cues[start]);
		const moves = cues.slice(start).map((cue, i) => ({cue, from: cue_key(cue), value: base + i * step}));
		if (moves[moves.length - 1].value > 9999 * 100 + 99) throw new Error("That would number cues past 9999");
		// Move DCA levels via temporary keys so renumbered cues can't overwrite each other's
		const levels = Object.fromEntries(moves.map((m) => [m.from, show.dcaLevels?.[m.from]]));
		for (const m of moves) delete show.dcaLevels?.[m.from];
		for (const m of moves) {
			Object.assign(m.cue, from_value(m.value));
			if (levels[m.from]) show.dcaLevels[cue_key(m.cue)] = levels[m.from];
		}
	},

	/**
	 * {cue, dca, channels, label, positions, profiles, levels, dcaLevel, exclusive}
	 * Set one DCA in a cue. Positions / profiles / levels (offsets in dB) are per channel ({ch: value}); a
	 * channel left out gets the default (first position, default profile, no offset). With
	 * exclusive (the default), channels are taken out of the cue's other DCAs.
	 * dcaLevel: this app's level for the DCA in dB (null: none; undefined: leave as is).
	 */
	set_dca(show, {cue, dca, channels = [], label = null, positions = {}, profiles = {}, levels = {}, dcaLevel, exclusive = true}) {
		const target = find_cue(show, cue);
		const list = [...new Set(channels.map(Number).filter((ch) => Number.isInteger(ch) && ch > 0))];

		if (exclusive) {
			for (let d = 1; d <= MAX_DCAS; d++) {
				if (d === dca) continue;
				const others = parse_channels(target[dca_field(d, 'Channels')]);
				const kept = others.filter((ch) => !list.includes(ch));
				if (kept.length === others.length) continue;
				target[dca_field(d, 'Channels')] = kept.join(",");
				// No blank DCAs: one left with nobody on it is cleared (label and level too)
				if (!kept.length) {
					target[dca_field(d, 'Label')] = null;
					set_dca_level_entry(show, cue, d, null);
				}
			}
		}

		target[dca_field(dca, 'Channels')] = list.join(",");
		target[dca_field(dca, 'Label')] = label && String(label).trim() ? String(label).trim() : null;

		const first_position = default_position(show);
		const maps = {
			channelPositions: [positions, (ch, v) => v !== undefined && v !== null && Number(v) !== first_position],
			channelProfiles: [profiles, (ch, v) => v !== undefined && v !== null && Number(v) !== default_profile(show, ch)?.id],
			channelLevels: [levels, (ch, v) => v !== undefined && v !== null && Number(v) !== 0],
		};
		for (const [field, [values, keep]] of Object.entries(maps)) {
			const map = parse_map(target[field]);
			for (const ch of list) {
				let v = values[ch];
				if (field === 'channelLevels' && v !== undefined && v !== null) {
					// dB in, tenths of a dB stored
					v = Math.round(Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, Number(v))) * OFFSET_SCALE);
				}
				if (keep(ch, v)) map.set(ch, String(v)); else map.delete(ch);
			}
			target[field] = serialize_map(map);
		}
		tidy_channel_maps(target);

		if (dcaLevel !== undefined) set_dca_level_entry(show, cue, dca, list.length ? dcaLevel : null);
	},

	/** {cue, dca}: unassign a DCA (channels, label, DCA level) */
	clear_dca(show, {cue, dca}) {
		OPS.set_dca(show, {cue, dca, channels: [], label: null, dcaLevel: null});
	},

	/** {values: {param: value}}: show settings (TheatreMix config); a null value removes it */
	set_config(show, {values}) {
		show.config = {...show.config};
		for (const [param, value] of Object.entries(values)) {
			if (value === null || value === undefined) delete show.config[param]; else show.config[param] = String(value);
		}
	},

	/**
	 * {profiles}: replace the channel profiles (Show Setup). New ones have no id. Cues, ensembles
	 * and actors that used a removed profile go back to the channel's default.
	 */
	set_profiles(show, {profiles}) {
		const next = assign_ids(profiles, show.profiles ?? []);
		const kept = new Set(next.map((p) => Number(p.id)));
		const removed = new Set((show.profiles ?? []).map((p) => Number(p.id)).filter((id) => !kept.has(id)));
		show.profiles = next;
		if (!removed.size) return;
		for (const cue of show.cues) cue.channelProfiles = drop_ids(cue.channelProfiles, removed);
		for (const e of show.ensembles ?? []) e.channelProfiles = drop_ids(e.channelProfiles, removed);
		show.actorProfiles = (show.actorProfiles ?? []).filter((ap) => !removed.has(Number(ap.profile)));
		show.channelSettings = (show.channelSettings ?? []).filter((r) => {
			const [kind, a, b] = r.owner.split(":");
			return !removed.has(Number(kind === 'profile' ? a : b));
		});
	},

	/** {ensembles}: replace the ensembles (Ensemble Setup). Cues aren't changed, like TheatreMix */
	set_ensembles(show, {ensembles}) {
		show.ensembles = assign_ids(ensembles, show.ensembles ?? []);
	},

	/** {positions}: replace the positions (Position Setup). Channels in a removed position go to the first */
	set_positions(show, {positions}) {
		const next = assign_ids(positions, show.positions ?? []);
		const kept = new Set(next.map((p) => Number(p.id)));
		const removed = new Set((show.positions ?? []).map((p) => Number(p.id)).filter((id) => !kept.has(id)));
		show.positions = next;
		const first = default_position(show);
		for (const cue of show.cues) {
			const map = parse_map(drop_ids(cue.channelPositions, removed));
			for (const [ch, id] of [...map]) if (Number(id) === first) map.delete(ch);
			cue.channelPositions = serialize_map(map);
		}
	},

	/** {actors, actorGroups}: replace the actors (Actor Setup), and the actor groups if given */
	set_actors(show, {actors, actorGroups}) {
		const next = assign_ids(actors, show.actors ?? []);
		const kept = new Set(next.map((a) => Number(a.id)));
		show.actors = next;
		show.actorProfiles = (show.actorProfiles ?? []).filter((ap) => kept.has(Number(ap.actor)));
		show.channelSettings = (show.channelSettings ?? []).filter((r) => !r.owner.startsWith("actor:") || kept.has(Number(r.owner.split(":")[1])));
		if (actorGroups) show.actorGroups = assign_ids(actorGroups, show.actorGroups ?? []);
	},

	/** {owner, section, data}: stored StudioLive settings for a profile / actor (data null removes them) */
	set_channel_settings(show, {owner, section, data}) {
		show.channelSettings = (show.channelSettings ?? []).filter((r) => !(r.owner === owner && r.section === section));
		if (data) show.channelSettings.push({owner, section, data: typeof data === 'string' ? data : JSON.stringify(data)});
	},

	/** {values: {param: value}}: this app's console setup (stored in the .tmixp); null removes */
	set_console_setup(show, {values}) {
		show.consoleSetup = {...show.consoleSetup};
		for (const [param, value] of Object.entries(values)) {
			if (value === null || value === undefined) delete show.consoleSetup[param]; else show.consoleSetup[param] = String(value);
		}
	},

	/** {cue, dca, level}: this app's level for a DCA in a cue (dB, or null for none) */
	set_dca_level(show, {cue, dca, level}) {
		find_cue(show, cue);
		set_dca_level_entry(show, cue, dca, level);
	},
};

/**
 * Apply edits to a show
 * @param {Object} show
 * @param {{op: String}[]} ops
 * @returns {Object[]} each op's result (e.g. {key} of a new cue)
 */
const apply_edits = (show, ops) => ops.map(({op, ...args}) => {
	const fn = OPS[op];
	if (!fn) throw new Error(`Unknown edit: ${op}`);
	return fn(show, args) ?? {};
});

/**
 * What typing into a DCA cell means: an ensemble name, a channel / profile name or label, or
 * channel numbers ("3" or "3,5"). Matching ignores case.
 * @returns {{kind: 'ensemble', ensemble: Object} | {kind: 'channels', channels: Number[], profiles: Object} | null}
 */
const resolve_dca_text = (show, text) => {
	const wanted = String(text ?? "").trim().toLowerCase();
	if (!wanted) return null;

	const ensemble = show.ensembles?.find((e) => String(e.name ?? "").trim().toLowerCase() === wanted);
	if (ensemble) return {kind: 'ensemble', ensemble};
	if (wanted === 'all') return {kind: 'ensemble', ensemble: all_ensemble(show)};

	if (/^\d+(\s*,\s*\d+)*$/.test(wanted)) return {kind: 'channels', channels: parse_channels(wanted), profiles: {}};

	const profile = show.profiles?.find((p) =>
		String(p.name ?? "").trim().toLowerCase() === wanted || String(p.label ?? "").trim().toLowerCase() === wanted);
	if (profile) {
		const ch = Number(profile.channel);
		return {kind: 'channels', channels: [ch], profiles: Number(profile.default) === 1 ? {} : {[ch]: profile.id}};
	}
	return null;
}

/**
 * Stored channel settings (TheatreMix's profiles: gain / high-pass / EQ / dynamics). Which
 * sections a profile stores lives in the profile's TheatreMix data ("storeParams=gain;hpf",
 * and "actorParams=..." for ones stored per actor); the StudioLive values themselves are this
 * app's channelSettings table: {owner: "profile:<id>" | "actor:<actor id>:<profile id>",
 * section, data: {param: value}}.
 */
const SETTING_SECTIONS = ['gain', 'hpf', 'eq', 'dyn'];

/** A profile's flags: {store: Set, actor: Set} of sections */
const profile_flags = (profile) => {
	const parts = new Map(String(profile?.data ?? "").split(",").map((p) => { const i = p.indexOf("="); return [p.slice(0, i), p.slice(i + 1)]; }));
	const set = (key) => new Set(String(parts.get(key) ?? "").split(";").filter((x) => SETTING_SECTIONS.includes(x)));
	return {store: set('storeParams'), actor: set('actorParams')};
}

/**
 * A profile's TheatreMix data with new flags (everything else in it kept as it is)
 * @param {String} data
 * @param {{store: Iterable, actor: Iterable}} flags
 */
const with_profile_flags = (data, {store, actor}) => {
	const kept = String(data ?? "").split(",").filter((p) => p && !p.startsWith("storeParams=") && !p.startsWith("actorParams="));
	const order = (set) => SETTING_SECTIONS.filter((x) => [...set].includes(x)).join(";");
	return [...kept, ...(order(store) ? [`storeParams=${order(store)}`] : []), ...(order(actor) ? [`actorParams=${order(actor)}`] : [])].join(",");
}

/** Can the show use all 24 of the StudioLive's DCAs? (Show Setup → Console) */
const uses_all_dcas = (show) => show?.consoleSetup?.allDcas === "1";

/**
 * The DCAs the show controls (Show Setup → DCAs to control), within what the show may use
 * @returns {Number[]}
 */
const show_dcas = (show) => {
	const max = uses_all_dcas(show) ? MAX_DCAS : DEFAULT_DCAS;
	const list = parse_channels(show?.config?.dcas).filter((d) => d <= max);
	return list.length ? list : Array.from({length: DEFAULT_DCAS}, (_, i) => i + 1);
}

/** The show's controlled channels (Show Setup), in order */
const controlled_channels = (show) => {
	const list = parse_channels(show.config?.channels);
	if (list.length) return list;
	return [...new Set((show.profiles ?? []).map((p) => Number(p.channel)))].sort((a, b) => a - b);
}

/** TheatreMix's automatic "All" ensemble: every controlled channel */
const all_ensemble = (show) => ({id: null, name: "All", channels: controlled_channels(show).join(","), channelProfiles: ""});

/** An ensemble's channels and the profiles it gives them */
const ensemble_channels = (ensemble) => ({
	channels: parse_channels(ensemble.channels),
	profiles: Object.fromEntries([...parse_map(ensemble.channelProfiles)].map(([ch, id]) => [ch, Number(id)])),
});

export {
	MAX_DCAS, TMIX_DCAS, DEFAULT_DCAS, MIN_OFFSET, MAX_OFFSET, uses_all_dcas, show_dcas,
	dca_field, cue_value, from_value, cue_key, parse_channels, parse_map, serialize_map,
	sorted_cues, default_position, default_profile, read_dca, cue_channel_dcas,
	apply_edits, resolve_dca_text, ensemble_channels, controlled_channels, all_ensemble,
	SETTING_SECTIONS, profile_flags, with_profile_flags,
};
