// utils/script_cues.js
// Cues from a script (File → Import Script), set up for line-by-line mixing: who speaks or sings
// (utils/script_parse.js), matched to the show's characters and ensembles as they are in Show
// Setup (the mic plot is the show's, not the script's), turned into cues.
//
// Typewriter style, the way line-by-line mixing is programmed: in each scene or song the first
// person to speak is on DCA 1, the next new voice on DCA 2, and so on left to right, so the
// mixer's hand walks along the faders with the dialogue. Someone who speaks again keeps their
// DCA. When the faders run out, the next cue reloads the bank from DCA 1:
//
//   - It's prepped: the cue fires during the last line of the bank before (whoever is talking
//     keeps their DCA, untouched), and loads DCA 1 onward with the next people to speak, so
//     they're ready before their lines.
//   - Cues come at songs, scenes and when the faders run out, not every line. A song or scene
//     cue already holds the first people who speak in it.
//   - Groups are the show's ensembles; ENSEMBLE / ALL are the Show Setup ensembles that cover
//     the company (e.g. Male and Female, a DCA each). A person in a group that's up is pulled
//     out onto their own DCA, and a group takes the people who aren't up already.
//
// Or a principal bank (Import Script → Layout), like Broadway's principal faders: the characters
// with the most lines each keep one DCA for the whole show (most lines on DCA 1), so muscle
// memory finds the same person in the same place. Everyone else takes the DCAs left over, and
// borrows a principal's DCA only while that principal isn't in the scene. At least two DCAs
// are left over for them.
//
//   - Numbered like a TheatreMix show: songs are whole numbers (song #7 is cue 7), the cues
//     after a song .1, .2 ... (.01, .02 ... when there are more than 9).

import { split_names } from './script_parse.js';
import { ensemble_channels, default_profile, parse_channels } from './show_edits.js';

/** "Young Simba's" -> "YOUNGSIMBAS" */
const norm = (text) => String(text ?? "").toUpperCase().replace(/[’']/g, "").replace(/[^A-Z0-9]/g, "");

// Script names that mean the whole company
const EVERYONE = /^(ALL|ENSEMBLE\d*|EVERYONE|COMPANY|FULLCOMPANY|TUTTI|CHORUS)$/;
// Sung lines in a row before the dialogue after them gets its own cue
const SUNG_RUN = 3;
// A script that marks fewer songs than this: this many sung words in a row after dialogue are a song
const MARKED_SONGS = 10;
const SONG_WORDS = 20;
// ... after at least this many spoken lines (sung lines broken by a word or two are one song)
const SPOKEN_BREAK = 3;
// A stage direction where someone comes or goes: "(SCAR enters.)", "(The HYENAS exit.)"
const ENTER_EXIT = /\b(enters?|exits?|exeunt|leaves?|runs? off|arrives?)\b/i;

/**
 * The show's ensembles that together cover the company: the biggest, then the biggest that
 * doesn't overlap it, and so on (Male and Female, not RAFIKIS too), in Show Setup's order
 * @param {Object} show
 */
const company_ensembles = (show) => {
	const all = (show.ensembles ?? []).map((e, order) => ({e, order, ch: parse_channels(e.channels)}));
	const picked = [];
	for (const x of [...all].sort((a, b) => b.ch.length - a.ch.length)) {
		if (x.ch.length && !picked.some((p) => p.ch.some((c) => x.ch.includes(c)))) picked.push(x);
	}
	return picked.sort((a, b) => a.order - b.order).map((p) => p.e);
}

/**
 * What a script name can be matched to (all from Show Setup): 'profile:<id>', 'ensemble:<id>',
 * 'company' (the ensembles that cover everyone) or 'ignore'
 * @param {Object} show
 * @returns {{id: String, label: String}[]}
 */
const match_targets = (show) => {
	const company = company_ensembles(show);
	return [
		...(show.profiles ?? []).map((p) => ({id: `profile:${p.id}`, label: `${p.name || p.label || `Channel ${p.channel}`} (ch ${p.channel})`})),
		...(show.ensembles ?? []).map((e) => ({id: `ensemble:${e.id}`, label: `Ensemble: ${e.name}`})),
		...(company.length > 1 ? [{id: 'company', label: `Company: ${company.map((e) => e.name).join(" + ")}`}] : []),
		{id: 'ignore', label: "Not miked / leave out"},
	];
}

/**
 * The best match in Show Setup for a script name ("" if none)
 * @param {Object} show
 * @param {String} name as written in the script ("YOUNG SIMBA", "RAFIKIS", "MUFASA’S VOICE")
 * @returns {String} a target id
 */
const guess_match = (show, name) => {
	let n = norm(name);
	if (EVERYONE.test(n)) {
		const company = company_ensembles(show);
		return company.length > 1 ? 'company' : company.length ? `ensemble:${company[0].id}` : "";
	}
	// "MUFASA’S VOICE" is Mufasa, "HYENA VOICES" the hyenas
	n = n.replace(/S?VOICES?$/, "") || n;
	const profiles = show.profiles ?? [];
	const exact = profiles.find((p) => norm(p.name) === n) ?? profiles.find((p) => norm(p.label) === n);
	if (exact) return `profile:${exact.id}`;
	const ensemble = (show.ensembles ?? []).find((e) => [n, `${n}S`, `${n}ES`, n.replace(/E?S$/, "")].includes(norm(e.name)));
	if (ensemble) return `ensemble:${ensemble.id}`;
	return "";
}

/**
 * Who a target is, as DCA slots (a company is several: one per ensemble)
 * @param {Object} show
 * @param {String} target from match_targets / guess_match
 * @returns {{key: String, channels: Number[], profiles: Object<number, number>, label: String | null}[]}
 */
const resolve_target = (show, target) => {
	if (!target || target === 'ignore') return [];
	if (target === 'company') return company_ensembles(show).map((e) => ({key: `ensemble:${e.id}`, ...ensemble_channels(e), label: e.name}));
	const [kind, value] = target.split(":");
	if (kind === 'profile') {
		const p = (show.profiles ?? []).find((x) => String(x.id) === value);
		if (!p) return [];
		const ch = Number(p.channel);
		// A character that isn't the line's default plays as its own profile
		return [{key: target, channels: [ch], profiles: default_profile(show, ch)?.id === p.id ? {} : {[ch]: p.id}, label: null}];
	}
	if (kind === 'ensemble') {
		const e = (show.ensembles ?? []).find((x) => String(x.id) === value);
		return e ? [{key: target, ...ensemble_channels(e), label: e.name}] : [];
	}
	return [];
}

const title_case = (text) => text.toLowerCase().replace(/(^|[\s(–—-])([a-z])/g, (_, before, c) => before + c.toUpperCase());

/** "Life's not fair, is it? I shall never be king…" -> "Life's not fair, is it?" */
const snippet = (text, length = 40) => {
	const t = text.replace(/\s+/g, " ").trim();
	if (t.length <= length) return t;
	const cut = t.slice(0, length);
	return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), length - 10))}…`;
}

/**
 * @typedef {Object} ScriptCue
 * @property {Number} number
 * @property {Number} point hundredths (10 = .1)
 * @property {String} name the cue's text
 * @property {{dca: Number, channels: Number[], label: String | null, profiles: Object}[]} dcas
 * @property {{page: Number, y: Number}} mark where it fires in the script
 * @property {'song' | 'scene' | 'reload'} kind
 */

/**
 * Make line-by-line cues from the script's events
 * @param {Object} show
 * @param {import('./script_parse.js').ScriptEvent[]} events
 * @param {Object<string, String>} map script name -> target (match_targets ids)
 * @param {{dcas: Number[], start?: Number, songs?: boolean, layout?: 'typewriter' | 'principal'}} options
 *   dcas: the DCAs to use, left to right; start: the first whole cue number; songs: a cue at each
 *   song; layout: typewriter (the default) or a principal bank
 * @returns {{cues: ScriptCue[], unmatched: String[], principals: {key: String, dca: Number}[]}}
 */
const make_cues = (show, events, map, {dcas, start = 1, songs = true, layout = 'typewriter'}) => {
	const unmatched = new Set();
	/** A name that's matched to someone (unmatched ones don't count as lines) */
	const people_known = (name) => split_names(name).some((n) => { const t = map[n] ?? map[name]; return t && t !== 'ignore'; });
	const fixed = layout === 'principal' ? principal_bank(show, events, map, dcas) : new Map();

	/** The DCA slots for a script name ("SHENZI, BANZAI" is two people) */
	const people = (name) => split_names(name).flatMap((n) => {
		const target = map[n] ?? map[name];
		if (target === undefined || target === "") { unmatched.add(n); return []; }
		return resolve_target(show, target).filter((s) => s.channels.length);
	});

	// Sections: a song or scene (or the start), then the lines in it. A scene heading with no
	// lines before the song after it joins the song's cue (the song cue preps the scene). In
	// dialogue (not songs), an entrance or exit starts a new section too, and so does the end of
	// a song's singing (the dialogue after it gets its own cue).
	const sections = [];
	const start_section = (fields) => sections.push({song: null, scene: null, direction: null, units: [], ...fields});

	// Sung and spoken lines in a row: singing has to run a few lines before the dialogue after it
	// is its own cue (a spoken word in the middle of a song isn't), and in a script that doesn't
	// mark its songs, a run of sung lines after dialogue is a song
	const voiced = events.filter((e) => (e.type === 'speech' || e.type === 'sing') && people_known(e.name));
	const sung_from = new Map(), sung_until = new Map(), spoken_from = new Map(), spoken_until = new Map();
	// sung_from counts words (a long solo is one line of the script but a lot of singing)
	const words = (e) => (e.text.match(/[A-Za-z']+/g) ?? []).length || 3;
	for (let i = voiced.length - 1; i >= 0; i--) {
		const next = voiced[i + 1];
		sung_from.set(voiced[i], voiced[i].type === 'sing' ? words(voiced[i]) + (next ? sung_from.get(next) : 0) : 0);
		spoken_from.set(voiced[i], voiced[i].type === 'speech' ? 1 + (next ? spoken_from.get(next) : 0) : 0);
	}
	voiced.forEach((e, i) => {
		sung_until.set(e, e.type === 'sing' ? 1 + (i ? sung_until.get(voiced[i - 1]) : 0) : 0);
		spoken_until.set(e, e.type === 'speech' ? 1 + (i ? spoken_until.get(voiced[i - 1]) : 0) : 0);
	});
	const find_songs = songs && events.filter((e) => e.type === 'song').length < MARKED_SONGS;

	for (const event of events) {
		const current = sections[sections.length - 1];
		const lastUnit = current?.units[current.units.length - 1];
		const hard = event.type === 'song' ? songs : event.type === 'scene';
		if (hard) {
			if (current && !current.units.length && !(event.type === 'song' && current.song)) {
				if (event.type === 'song') current.song = event;
				continue;
			}
			start_section({first: event, song: event.type === 'song' ? event : null, scene: event.type === 'scene' ? event : null});
			continue;
		}
		if (event.type === 'direction') {
			if (ENTER_EXIT.test(event.text) && lastUnit?.event.type === 'speech') start_section({first: event, direction: event});
			continue;
		}
		if (event.type !== 'speech' && event.type !== 'sing') continue;
		const slots = people(event.name);
		if (!slots.length) continue;
		// The singing's over: the dialogue after it is a new cue, loaded during the last sung line
		if (event.type === 'speech' && lastUnit?.event.type === 'sing' && sung_until.get(lastUnit.event) >= SUNG_RUN && spoken_from.get(event) >= 2) {
			start_section({first: lastUnit.event, dialogue: true});
		}
		// A song the script doesn't mark: sung lines after dialogue (named from its first line)
		const before = voiced[voiced.indexOf(event) - 1];
		if (find_songs && event.type === 'sing' && sung_from.get(event) >= SONG_WORDS && (!before || spoken_until.get(before) >= SPOKEN_BREAK)) {
			start_section({first: event, song: {type: 'song', song: null, page: event.page, y: event.y, text: event.text ? snippet(event.text, 32) : `${event.name} sings`}});
		}
		if (!sections.length) start_section({first: event});
		sections[sections.length - 1].units.push({event, slots});
	}

	const cues = [];
	for (const section of sections) {
		// A section with no one in it is only a cue if it's a song (the music still has a cue)
		if (!section.units.length) {
			if (section.song) cues.push({kind: 'song', song: section.song.song, name: song_name(section.song), dcas: [], mark: at(section.first)});
			continue;
		}
		let pos = 0;
		let held = [];          // [dca, slot] still talking when the cue fires
		let fire = section.first;
		let first = true;
		while (pos < section.units.length) {
			const {bank, end} = fill_bank(section.units, pos, held, dcas, fixed);
			const next = section.units[pos].event;
			cues.push({
				kind: first && section.song ? 'song' : first ? 'scene' : 'reload',
				song: first && section.song ? section.song.song : null,
				name: first && section.song ? song_name(section.song)
					: first && section.scene ? title_case(section.scene.text)
					: first && section.direction ? comings_and_goings(section.direction.text)
					: first && section.dialogue ? `Dialogue: ${title_case(next.name)}`
					: next.type === 'sing' ? `${title_case(next.name)} sings`
					: `${title_case(next.name)}: ${snippet(next.text)}`,
				dcas: [...bank.entries()].sort((a, b) => a[0] - b[0]).map(([dca, s]) => ({dca, channels: s.channels, label: s.label, profiles: s.profiles})),
				mark: at(fire),
			});
			if (end >= section.units.length) break;
			// Prep the next bank: it fires on this bank's last line, keeping whoever's talking
			const last = section.units[end - 1];
			held = [...bank.entries()].filter(([, s]) => last.slots.some((p) => p.key === s.key));
			fire = last.event;
			pos = end;
			first = false;
		}
	}

	// A cue that changes nothing (the same people on the same DCAs as the cue before) isn't
	// needed, unless it's a song's
	const same = (a, b) => JSON.stringify(a.dcas) === JSON.stringify(b.dcas);
	const needed = cues.filter((cue, i) => cue.kind === 'song' || i === 0 || !same(cue, cues[i - 1]));
	return {cues: number_cues(needed, start), unmatched: [...unmatched], principals: [...fixed].map(([key, dca]) => ({key, dca}))};
}

// Principal bank: a character needs this many lines to be a principal
const PRINCIPAL_LINES = 3;

/**
 * The principal bank: the characters with the most lines, each with their own DCA
 * @returns {Map<String, Number>} profile target -> DCA
 */
const principal_bank = (show, events, map, dcas) => {
	const counts = new Map();
	for (const e of events) {
		if (e.type !== 'speech' && e.type !== 'sing') continue;
		for (const n of split_names(e.name)) {
			const target = map[n] ?? "";
			if (target.startsWith('profile:')) counts.set(target, (counts.get(target) ?? 0) + 1);
		}
	}
	const ranked = [...counts].filter(([, c]) => c >= PRINCIPAL_LINES).sort((a, b) => b[1] - a[1]);
	return new Map(ranked.slice(0, Math.max(0, dcas.length - 2)).map(([key], i) => [key, dcas[i]]));
}

const song_name = (event) => event.song ? `#${event.song} – ${title_case(event.text)}` : title_case(event.text);

/**
 * A cue name from an entrance / exit: "(MUFASA exits, with ZAZU behind him. YOUNG NALA enters.)"
 * -> "Mufasa Exits / Young Nala Enters" (names in a direction are in capitals)
 * @param {String} text
 */
const comings_and_goings = (text) => {
	const found = [...text.matchAll(/((?:[A-Z][A-Z’']+(?:,? (?:and |& )?| (?=[A-Z])))+)\s*(enters?|exits?|exeunt|leaves?|runs? off|arrives?)\b/g)]
		.map((m) => `${title_case(m[1].replace(/,?\s*$/, "").replace(/\b(and|&)\b/gi, "&"))} ${title_case(m[2])}`);
	if (found.length) return found.slice(0, 2).join(" / ");
	const plain = text.replace(/^\(|\)\.?$|\.$/g, "");
	return snippet(plain.charAt(0).toUpperCase() + plain.slice(1), 44);
}
const at = (event) => ({page: event.page, y: event.y});

/**
 * Lay out one bank, typewriter style: the held DCAs stay; new voices take the next free DCA,
 * lowest first, in the order they speak; stops before a line that won't fit
 * @param {{slots: Object[]}[]} units the lines
 * @param {Number} start the first line in this bank
 * @param {[Number, Object][]} held DCAs kept from the cue before (still talking)
 * @param {Number[]} dcas
 * @param {Map<String, Number>} fixed principal bank: character -> their DCA (empty: typewriter)
 * @returns {{bank: Map<number, Object>, end: Number}} the bank (DCA -> slot) and the line after it
 */
const fill_bank = (units, start, held, dcas, fixed) => {
	const copy = (m) => new Map([...m.entries()].map(([d, s]) => [d, {...s, channels: [...s.channels]}]));
	let bank = copy(new Map(held));
	let i = start;
	for (; i < units.length; i++) {
		const trial = copy(bank);
		if (units[i].slots.every((slot) => place(trial, slot, dcas, fixed))) { bank = trial; continue; }
		// Always take at least one line (more voices at once than DCAs: as many as fit)
		if (i === start) { for (const slot of units[i].slots) place(bank, slot, dcas, fixed); i++; }
		break;
	}
	return {bank, end: i};
}

/**
 * Put a voice on the bank if it isn't up: a person in a group that's up comes out of the group
 * onto their own DCA; a group takes only the people who aren't up yet
 * @param {Map<number, Object>} bank changed in place
 * @param {Map<String, Number>} [fixed] principal bank: a principal goes on their own DCA; others
 *   take the DCAs that aren't principals', then (borrowing) any that's free
 * @returns {boolean} false if there's no DCA left for it
 */
const place = (bank, slot, dcas, fixed = new Map()) => {
	if ([...bank.values()].some((s) => s.key === slot.key)) return true;
	const up = (ch) => [...bank.values()].some((s) => s.channels.includes(ch));
	let channels = slot.channels;
	if (channels.length > 1) {
		channels = channels.filter((ch) => !up(ch));
		if (!channels.length) return true;      // everyone in it is up already
	}
	const reserved = new Set(fixed.values());
	const free = fixed.has(slot.key) ? (bank.has(fixed.get(slot.key)) ? undefined : fixed.get(slot.key))
		: dcas.find((d) => !bank.has(d) && !reserved.has(d)) ?? dcas.find((d) => !bank.has(d));
	if (free === undefined) return false;
	if (slot.channels.length === 1) {
		for (const [d, s] of [...bank.entries()]) {
			if (!s.channels.includes(channels[0])) continue;
			if (s.channels.length > 1) {
				s.channels = s.channels.filter((ch) => ch !== channels[0]);
				if (!s.channels.length) bank.delete(d);
			} else {
				bank.delete(d);   // the same mic as another character
			}
		}
	}
	bank.set(free, {...slot, channels, profiles: Object.fromEntries(Object.entries(slot.profiles).filter(([ch]) => channels.includes(Number(ch))))});
	return true;
}

/**
 * Number the cues: a song is its song number (when that keeps the order), the cues after it
 * .1, .2 ... (.01, .02 ... for more than 9)
 * @param {Object[]} cues
 * @param {Number} start the first whole number
 */
const number_cues = (cues, start) => {
	// A song starts a new whole number if it's the next song: numbered in order (#7 after #6), or
	// in a script that doesn't number its songs. A lettered song (#6a) or one out of order (a
	// #30 scene-change cue early on) is a cue under the song before, with its name.
	const song_numbers = cues.filter((c) => c.kind === 'song' && /^\d+$/.test(String(c.song ?? ""))).map((c) => Number(c.song));
	const numbered_songs = song_numbers.length > 0;
	// Added after other cues (starting at 24): the script's songs move up to start there
	const offset = numbered_songs && Math.min(...song_numbers) < start - 1 ? start - Math.min(...song_numbers) : 0;
	const number_of = (cue) => /^\d+$/.test(String(cue.song ?? "")) ? Number(cue.song) + offset : NaN;
	let whole = start - 1;
	const heads = [];
	for (const cue of cues) {
		if (cue.kind !== 'song') continue;
		const n = number_of(cue);
		if (Number.isInteger(n) && n > whole && n <= whole + 3) { whole = n; heads.push(cue); }
		else if (!numbered_songs) { whole += 1; heads.push(cue); }
	}
	const head_set = new Set(heads);

	const runs = [];
	for (const cue of cues) {
		if (head_set.has(cue) || runs.length === 0) runs.push({head: head_set.has(cue) ? cue : null, rest: head_set.has(cue) ? [] : [cue]});
		else runs[runs.length - 1].rest.push(cue);
	}
	whole = start - 1;
	const numbered = [];
	for (const run of runs) {
		if (run.head) {
			const n = number_of(run.head);
			whole = Number.isInteger(n) && n > whole && n <= whole + 3 ? n : whole + 1;
			numbered.push({...run.head, number: whole, point: 0});
		}
		if (run.rest.length > 99) throw new Error(`More than 99 cues between songs (after cue ${whole})`);
		const step = run.rest.length <= 9 ? 10 : 1;
		run.rest.forEach((cue, i) => numbered.push({...cue, number: whole, point: (i + 1) * step}));
	}
	return numbered;
}

export { make_cues, guess_match, match_targets, resolve_target, company_ensembles, norm };
