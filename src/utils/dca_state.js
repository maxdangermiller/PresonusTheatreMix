/**
 * TheatreMix's DCA color coding: what happens to a DCA in the next cue. Shared by the console
 * (DCA scribble strip colors, main/sound.js) and the cue list (cell colors).
 *   off       nothing assigned
 *   same      same channels, positions, FX and profiles next: safe to Go with the fader up
 *   change    the assignment changes next: Go with the fader down
 *   ensemble  channels join an ensemble: an ensemble DCA (2+ channels) that keeps all its channels
 *             and gains more, and the DCAs whose channels all move into it (safe if the DCAs
 *             share a level). Channels leaving an ensemble, or forming a new one, are a "change".
 *   position  same channels, one changes position
 *   fx        same channels, one changes FX
 *   profile   same channels, one changes profile
 */

import { dca_field, parse_channels, parse_map, cue_value, MAX_DCAS } from './show_edits.js';

/**
 * The cue Go would fire after `cue` (skipped cues passed over); null after the last one.
 * With no cue (Line Checks), the first cue.
 * @param {Object[]} cues
 * @param {Object | null} cue
 */
const next_cue = (cues, cue) => {
	const sorted = [...cues].sort((a, b) => cue_value(a) - cue_value(b));
	const start = cue === null ? 0 : sorted.findIndex((c) => cue_value(c) === cue_value(cue)) + 1;
	if (cue !== null && start === 0) return null;
	return sorted.slice(start).find((c) => !Number(c.skip)) ?? null;
}

/**
 * A DCA's state in `cue` compared with `next` (see the list above)
 * @param {Object | null} cue the cue now (null: Line Checks, nothing assigned)
 * @param {Object | null} next the next cue (null: last cue, nothing coming)
 * @param {Number} dca
 * @returns {'off' | 'same' | 'change' | 'ensemble' | 'position' | 'fx' | 'profile'}
 */
const dca_next_state = (cue, next, dca) => {
	const now = cue ? parse_channels(cue[dca_field(dca, 'Channels')]) : [];
	if (now.length === 0) return 'off';
	if (next === null) return 'same';

	const then = parse_channels(next[dca_field(dca, 'Channels')]);
	const key = (channels) => [...channels].sort((a, b) => a - b).join(",");
	if (key(now) !== key(then)) return joins_ensemble(cue, next, dca) ? 'ensemble' : 'change';

	// Same channels: does one of them change position, FX or profile?
	const changes = (field) => {
		const a = parse_map(cue[field]), b = parse_map(next[field]);
		return now.some((ch) => (a.get(ch) ?? "") !== (b.get(ch) ?? ""));
	};
	return changes('channelPositions') ? 'position'
		: changes('channelFX') ? 'fx'
		: changes('channelProfiles') ? 'profile'
		: 'same';
}

/**
 * Is this DCA part of an ensemble growing in the next cue: it's an ensemble DCA (2+ channels)
 * keeping all its channels and gaining more, or its channels all move into one?
 * (TheatreMix: 2.21 RAFIKIS 10-14 + Rafiki 6 on its own -> 2.22 RAFIKIS 10-15: both)
 * @param {Object} cue
 * @param {Object} next
 * @param {Number} dca
 */
const joins_ensemble = (cue, next, dca) => {
	const now = parse_channels(cue[dca_field(dca, 'Channels')]);
	for (let d = 1; d <= MAX_DCAS; d++) {
		const before = parse_channels(cue[dca_field(d, 'Channels')]);
		const after = parse_channels(next[dca_field(d, 'Channels')]);
		const grows = before.length >= 2 && after.length > before.length && before.every((ch) => after.includes(ch));
		if (grows && (d === dca || now.every((ch) => after.includes(ch)))) return true;
	}
	return false;
}

/**
 * TheatreMix's color-blind palette: cyan and orange show as green, yellow as magenta, magenta as cyan
 * @param {String} state
 */
const color_blind_state = (state) => ({position: 'same', fx: 'same', profile: 'ensemble', ensemble: 'position'}[state] ?? state);

export { next_cue, dca_next_state, color_blind_state };
