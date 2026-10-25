// utils/script_parse.js
// Reads a play script's text (from a PDF, utils/script_pdf.js; scanned pages through text
// recognition) into what happens in order: scenes, songs, who speaks or sings each line, and
// stage directions, each with where it is on the page (so cues can be marked on the script).
// Reads the two usual layouts:
//
//   Name above the line (MTI, Broadway Junior, most musicals):
//                    YOUNG SIMBA                 <- a character's name, in capitals, centered
//     Hey, Uncle Scar! Guess what? ...           <- what they say, under it
//                    (NATHAN)                    <- the same speaker, continued from the page before
//
//   Name before the line (Samuel French and older typed scripts):
//     MISS STRICT: Mr. Warner, I couldn't ...    <- name, colon, what they say
//     TOFFEE:                                    <- a singer, lyrics under in capitals
//       LIFE'S A TRAP ...
//
// and in both:
//     SCENE FIVE: THE PRIDELANDS / ACT I, Scene ii: Mission    <- scenes
//     (#6 – OUR LITTLE SECRET.) / #3 - Follow the Fold           <- song cues
//                    AIN'T NO GOIN' BACK                         <- a song's title, then its singers
//     RAFIKIS: / (RAFIKIS):                                      <- who sings, in sheet music
//
// Lines in capitals are sung. Page furniture (running headers, page numbers) and notes in the
// margins (lighting / sound cues written on the script: "Q5.4", "Spot 1: Sarah", "LIGHT CUE")
// are left out. Nothing here depends on fonts; it goes by capitals, position and punctuation.

/**
 * @typedef {Object} ScriptLine one line of text on a page
 * @property {Number} page 1-based
 * @property {Number} y distance from the top of the page (PDF points)
 * @property {Number} x left edge
 * @property {Number} width
 * @property {Number} height text height
 * @property {String} text
 * @property {Number} pageWidth
 * @property {Number} [pageHeight]
 */

/**
 * @typedef {Object} ScriptEvent
 * @property {'scene' | 'song' | 'speech' | 'sing' | 'direction'} type
 *   speech: a character's line; sing: lyrics, or who sings next in a song's music
 * @property {Number} page
 * @property {Number} y top of the event on the page
 * @property {String} [name] the character / group as written ("YOUNG SIMBA")
 * @property {String} text what's said, the scene / song title, or the direction
 * @property {String | null} [song] song number ("6", "12A"; null for a song with only a title)
 */

// A name: capitals (and digits, spaces, & . , ' # / -), no lower case
const NAME = "[A-Z][A-Z0-9 .,'’&/#-]*[A-Z0-9#]";
const NAME_TEXT = new RegExp(`^${NAME}$`);
// "MISS STRICT: Attention, students" / "TOFFEE:" / "(RAFIKIS):"
const INLINE = new RegExp(`^\\(?(${NAME})\\)?\\s*:\\s*(.*)$`);
// "(NATHAN)": the speaker carried on from the page before
const CONTINUED = new RegExp(`^\\((${NAME})\\)$`);
// Words that look like names but aren't
const NOT_NAMES = new Set(["SCRIPT", "NOTE", "NOTES", "THE END", "END OF ACT", "BLACKOUT", "CURTAIN", "INTERMISSION", "ACT ONE", "ACT TWO", "PROLOGUE",
	"TABLE OF CONTENTS", "CHARACTERS", "MUSICAL NUMBERS", "LIGHT CUE", "MUSIC CUE", "SOUND CUE", "FADE OUT", "LIGHTS UP", "END OF SCENE"]);
// "SCENE FIVE: THE PRIDELANDS", "ACT I, Scene ii: Interior", "Scene 3", "ACTI"
// (text recognition mixes up I, l and 1: "ACT 1I")
const SCENE = /^(SCENE|ACT)\s*([0-9IVXl]+|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE)\b[:.,]?\s*(.*)$/i;
// (#6 – OUR LITTLE SECRET ...) / (#2A - Circle of Life Reprise.) / "(End of play. #22 – BOWS.)"
const SONG_CUE = /\(.{0,40}?#\s*(\d+[A-Z]?)\s*[–—-]\s*([^.)]+)/;
// "#3 - Follow the Fold", "#30-Exit of Sarah" as a heading of its own ("O" is a misread 0)
const SONG_HEADING = /^#\s*([\dO]+[A-Za-z]?)\s*[–—-]\s*(.+)$/;
// Notes written on the script for lighting / sound, not the play: "Q5.4", "Q0.1: Program Live",
// "Spot 1: Tight on Sarah", "LIGHT CUE"
const NOTE = /^(Q\s?\d+(\.\d+)?[A-Za-z]?\b(:.*)?|Spot\s*\d+\s*:.*|(LIGHT|LIGHTS|MUSIC|SOUND|SPOT|FLY|LX|SQ)\s+CUE\b.*)$/i;
// A cue number written at the start of a line of script: "Q1.4 After eight bars of music ..."
// ("Q91 .0" as text recognition can read it)
const NOTE_PREFIX = /^Q\s?\d+(\s?\.\s?\d+)?[A-Za-z]?:?\s+(?=[A-Z(])/;

// Notes in the outer margins (the play is between them)
const LEFT_MARGIN = 0.1;
const RIGHT_MARGIN = 0.78;
// A gap this many line heights above a line ends the speech before it (a song title, a
// picture or the end of a scene, not the next line of the same speech)
const SPEECH_GAP = 2.2;

/**
 * Is this line a character's name above their speech: capitals, short, roughly centered
 * @param {ScriptLine} line
 */
const is_name_line = (line) => {
	const text = line.text.trim();
	if (!NAME_TEXT.test(text) || text.length > 32 || NOT_NAMES.has(text) || SCENE.test(text)) return false;
	const words = text.split(/\s+/);
	// Real words (sheet music symbols come out as lone capitals: "K K")
	if (words.length > 5 || words.some((w) => /^[A-Z]$/.test(w))) return false;
	// Centered: its middle near the page's middle (script margins are often uneven: generous)
	const middle = line.x + line.width / 2;
	return Math.abs(middle - line.pageWidth / 2) < line.pageWidth * 0.2;
}

/** Page numbers and running heads */
const is_furniture_text = (text) => /^[-–\s]*\d+[-–\s]*$/.test(text) || /^[ivxlc]+$/i.test(text) || text === "SCRIPT"
	|| /Music Theatre International|Broadway Junior|Actor’s Script|Actor's Script|Disney’s|Disney's/.test(text);

/** A running head's text to compare: letters only ("ZOMBIE PROM 13" and "ZOMBIE'PROM 35" are the same) */
const head_key = (text) => text.toUpperCase().replace(/[^A-Z]/g, "");

/**
 * Lines that are on most pages near the top or bottom (the show's title as a running head,
 * "GUYS & DOLLS - 5 -"): page furniture
 * @param {ScriptLine[]} lines
 * @returns {Set<String>} their text, with digits taken out
 */
const running_heads = (lines) => {
	const key = head_key;
	const pages = new Map();
	for (const line of lines) {
		const height = line.pageHeight ?? line.pageWidth * 1.3;
		if (line.y > height * 0.1 && line.y < height * 0.9) continue;
		const k = key(line.text);
		if (!k) continue;
		if (!pages.has(k)) pages.set(k, new Set());
		pages.get(k).add(line.page);
	}
	const total = new Set(lines.map((l) => l.page)).size;
	return new Set([...pages].filter(([, p]) => p.size >= Math.max(4, total * 0.2)).map(([k]) => k));
}

/**
 * Is this text a running head, or one misread by text recognition ("WMBIEPROM" for ZOMBIEPROM)?
 * @param {Set<String>} heads from running_heads
 * @param {String} text
 */
const is_running_head = (heads, text) => {
	const k = head_key(text);
	if (!k) return false;
	for (const head of heads) {
		if (k === head) return true;
		if (head.length >= 6 && Math.abs(k.length - head.length) <= 2 && edit_distance(k, head) <= 2) return true;
	}
	return false;
}

/** Levenshtein distance */
const edit_distance = (a, b) => {
	let row = Array.from({length: b.length + 1}, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const next = [i];
		for (let j = 1; j <= b.length; j++) next.push(Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
		row = next;
	}
	return row[b.length];
}

/**
 * Sheet music: notes and lyric fragments come out as short bits and symbols. A line of prose
 * has words and few symbols.
 * @param {String} text
 */
const is_music = (text) => {
	const letters = (text.match(/[A-Za-z]/g) ?? []).length;
	return letters < text.length * 0.5 || /[œŒ∑Ó]/.test(text) || /^[\d\s|&#b-]+$/.test(text)
		// Lyrics under the notes are split into syllables: "ev - er", "Nan ts’in go - - nya"
		|| /\w\s?-\s+\w|\s-\s-|\s-$/.test(text)
		// A bar number before a singer's name: "28 RAFIKI 4:"
		|| /^\d+\s+[A-Z][A-Z ]*:/.test(text);
}

/** Mostly capitals: lyrics (scripts print what's sung in capitals) */
const is_capitals = (text) => {
	const letters = text.replace(/\([^)]*\)/g, "").match(/[A-Za-z]/g) ?? [];
	return letters.length >= 3 && letters.filter((c) => c >= 'A' && c <= 'Z').length / letters.length > 0.85;
}

/** MTI scripts have a "SCRIPT" tab down the page edge that runs into the line next to it */
const without_tab = (text) => text.replace(/^SCRIPT\s?(?=[A-Z(“"‘'…])/, "").replace(/\s+SCRIPT$/, "");

/**
 * A line's text, tidied: the side tab, a cue number written before it ("Q1.4 After eight bars"),
 * a speck read as a letter before a heading ("i ACT 1, Scene v") and a spot note read onto its end
 * @param {String} text
 */
const tidy = (text) => without_tab(text.replace(/\|/g, " ").replace(/\s+/g, " ").trim())
	.replace(/^[iIl]\s+(?=ACT\b|SCENE\b|Q\s?\d)/i, "")
	.replace(NOTE_PREFIX, "")
	.replace(/\s+Spot\s*\d+\s*:.*$/i, "")
	.trim();

/**
 * A song's title page in an MTI script: the title in capitals, then again in ordinary case
 * ("HAKUNA MATATA" / "Hakuna Matata (Part 1)"), which reads like a name and a line
 * @param {ScriptEvent} speech
 */
const is_title = (speech) => {
	const letters = (text) => text.toLowerCase().replace(/[^a-z]/g, "");
	const name = letters(speech.name);
	return speech.text.length < 100 && name.length >= 4 && letters(speech.text).slice(0, name.length + 12).includes(name);
}

/**
 * The script's events, in order
 * @param {ScriptLine[]} lines every line, page by page, top to bottom
 * @returns {ScriptEvent[]}
 */
const parse_script = (all) => {
	const heads = running_heads(all);
	const edge = (line) => { const h = line.pageHeight ?? line.pageWidth * 1.3; return line.y < h * 0.1 || line.y > h * 0.9; };
	// The play's lines: no furniture, margin notes or lighting notes
	const lines = all.map((line) => ({...line, text: tidy(line.text)}))
		.filter((line) => line.text && !is_furniture_text(line.text) && !(edge(line) && is_running_head(heads, line.text)) && !NOTE.test(line.text)
			&& line.x + line.width > line.pageWidth * LEFT_MARGIN && line.x < line.pageWidth * RIGHT_MARGIN);

	// Centered capitals are names above speeches, but in songs they're also lyrics. A name is
	// followed by what they say (not capitals); a lyric line isn't, unless it's a singer's name
	// that speaks somewhere else in the script.
	const key = (name) => name.replace(/[^A-Z0-9]/g, "");
	const speakers = new Set();
	lines.forEach((line, i) => {
		const inline = INLINE.exec(line.text);
		if (inline && inline[2] && !is_capitals(inline[2])) speakers.add(key(inline[1]));
		// What follows, past a parenthetical ("(scheming)") under the name
		const next = lines.slice(i + 1, i + 4).find((l) => !l.text.startsWith("("));
		if (is_name_line(line) && next && next.page === line.page && !is_capitals(next.text) && !NAME_TEXT.test(next.text) && !INLINE.test(next.text)) speakers.add(key(line.text));
	});
	const is_speaker = (line) => is_name_line(line) && split_names(line.text).every((n) => speakers.has(key(n)));

	// The play starts at its first scene heading (skips the title page, contents, notes); a
	// script without scene headings starts at the top
	let started = !lines.some((l) => SCENE.test(l.text) && l.text.length < 70);

	const events = [];
	/** The speech being read: more lines get added to it */
	let speech = null;
	/** A stage direction being read (they can run over several lines) */
	let direction = null;
	/** The last line read, to see gaps */
	let previous = null;

	const finish = () => {
		if (speech) {
			speech.text = speech.text.replace(/\s+/g, " ").trim();
			// Bits of sheet music ("K K", a bar number) aren't a line
			if ((speech.text.match(/[A-Za-z]{2,}/g) ?? []).length < 2 && !/[A-Za-z]{3,}[!?.…]/.test(speech.text)) speech.text = "";
			if (speech.text && !is_title(speech)) {
				if (is_capitals(speech.text)) speech.type = 'sing';
				events.push(speech);
			} else if (!speech.text && speech.inline) {
				// "RAFIKIS:" in sheet music: who sings next
				events.push({...speech, type: 'sing', text: ""});
			}
		}
		if (direction) finish_direction(direction, events);
		speech = null;
		direction = null;
	}

	lines.forEach((line, index) => {
		const text = line.text;
		const gap = previous && previous.page === line.page ? (line.y - (previous.y + previous.height)) / Math.max(8, line.height) : Infinity;
		previous = line;

		// Scenes
		if (SCENE.test(text) && text.length < 70) {
			finish();
			started = true;
			// "ACTI" (misread "ACT I") reads "ACT I"
			events.push({type: 'scene', page: line.page, y: line.y, text: text.replace(/^(act|scene)\s*(?=[ivx0-9])/i, "$1 ")});
			return;
		}
		if (!started) return;

		// "#3 - Follow the Fold"
		const heading = SONG_HEADING.exec(text);
		if (heading) {
			finish();
			events.push({type: 'song', page: line.page, y: line.y, song: heading[1].replace(/O/g, "0"), text: heading[2].trim()});
			return;
		}

		// A stage direction: from "(" to ")", maybe over several lines
		if (direction) {
			direction.text += ` ${text}`;
			if (text.includes(")")) { finish_direction(direction, events); direction = null; }
			return;
		}
		const continued = CONTINUED.exec(text);
		if (continued && is_speaker({...line, text: continued[1]})) {
			finish();
			speech = {type: 'speech', page: line.page, y: line.y, name: continued[1], text: ""};
			return;
		}
		if (text.startsWith("(") && !INLINE.test(text)) {
			// A parenthetical inside a speech ("(scheming)") stays with the speech
			if (speech && /^\([^)]*\)$/.test(text) && text.length < 60 && !SONG_CUE.test(text)) return;
			finish();
			direction = {type: 'direction', page: line.page, y: line.y, text};
			if (text.includes(")")) { finish_direction(direction, events); direction = null; }
			return;
		}

		// "NAME: what they say" (or "NAME:" before lyrics or sheet music)
		const inline = INLINE.exec(text);
		if (inline && !NOT_NAMES.has(inline[1]) && /[A-Z]{2}/.test(inline[1])) {
			finish();
			const said = inline[2].replace(/^\([^)]*[)}]\s*/, "");
			speech = {type: 'speech', page: line.page, y: line.y, name: inline[1].trim(), text: said, inline: true};
			return;
		}

		if (is_name_line(line)) {
			// A song's title (a centered heading in capitals) with its singers straight after
			const next = lines[index + 1];
			// (not in the middle of singing: there a line before "GIRLS:" is a lyric, called and answered)
			const singing = (speech && is_capitals(speech.text)) || events[events.length - 1]?.type === 'sing';
			if (!singing && !is_speaker(line) && next && next.page === line.page && INLINE.test(next.text) && !INLINE.exec(next.text)[2].replace(/^\([^)]*[)}]\s*/, "").trim()) {
				finish();
				events.push({type: 'song', page: line.page, y: line.y, song: null, text});
				return;
			}
		}
		if (is_speaker(line)) {
			finish();
			speech = {type: 'speech', page: line.page, y: line.y, name: text, text: ""};
			return;
		}

		// Sheet music, or a big gap, ends a speech
		if (is_music(text)) { if (speech) finish(); return; }
		if (speech && speech.text && gap > SPEECH_GAP) { finish(); return; }
		if (speech) speech.text += ` ${text}`;
	});
	finish();
	return events;
}

/**
 * A finished stage direction: a song cue in it becomes a song event
 * @param {ScriptEvent} direction
 * @param {ScriptEvent[]} events
 */
const finish_direction = (direction, events) => {
	direction.text = direction.text.replace(/\s+/g, " ").trim();
	const song = SONG_CUE.exec(direction.text);
	if (song) events.push({type: 'song', page: direction.page, y: direction.y, song: song[1], text: song[2].trim().replace(/\s+/g, " ")});
	else events.push(direction);
}

/**
 * Names in a script heading can stand for several characters: "SIMBA & NALA", "RAFIKIS 1-3"
 * @param {String} name
 * @returns {String[]} the separate names
 */
const split_names = (name) => name.split(/\s*(?:&|\/|,|\bAND\b)\s*/).map((n) => n.trim()).filter(Boolean);

export { parse_script, split_names, is_name_line, edit_distance };
