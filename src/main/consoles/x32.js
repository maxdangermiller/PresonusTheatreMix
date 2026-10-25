// main/consoles/x32.js
// Behringer X32 / Midas M32 support. The rest of the app talks to consoles through the
// StudioLive API's Client (main/sound.js, consoleButtons.js, channelMonitor.js); this class
// offers the same methods and events, with StudioLive-style parameter names and units, and
// turns them into the X32's OSC messages (UDP port 10023). So everything the app does on a
// StudioLive (DCAs, names, colors, mutes, faders, mute group Go / Back, channel monitoring,
// stored channel settings) works the same on an X32.
//
// Units: faders are converted through dB between the two consoles' fader laws. Stored channel
// settings stay in the StudioLive's 0-1 ranges (converted through dB / Hz / Q), so a show's
// stored EQ means the same on either console. Settings the X32 has no match for (digital
// gain, EQ band on/off, compressor ratio / attack / release / knee, the limiter) are skipped.
//
// Protocol: Behringer's "Unofficial X32/M32 OSC Remote Protocol" (Patrick-Gilles Maillot).
// /xremote subscribes to changes for 10 s (renewed every few seconds), /xinfo answers with
// the console's IP, name, model and firmware, a message with no arguments reads a value.

import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';

import { encode, decode, int } from './osc.js';
import { level_to_fader, fader_to_level_exact } from '../../utils/dca_levels.js';
import { UNITS } from '../../utils/studiolive_units.js';

const X32_PORT = 10023;
const LINES = 32;
const DCAS = 8;
const MUTE_GROUPS = 6;
const NAME_LENGTH = 12;

// /xremote lasts 10 s; renew well before that. No reply to /xinfo for this long: connection lost.
const REMOTE_RENEW_MS = 8000;
const PING_MS = 3000;
const LOST_MS = 10000;
// Meter subscriptions last 10 s too
const METER_RENEW_MS = 9000;
// Requests at connect go out this many at a time, this far apart (the X32 drops floods)
const BATCH = 40;
const BATCH_GAP_MS = 15;

const two = (n) => String(n).padStart(2, "0");
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// #region Fader law

/** X32 fader (0-1) -> dB (four straight segments; 0 is -∞) */
const x32_fader_to_db = (f) => f >= 0.5 ? f * 40 - 30 : f >= 0.25 ? f * 80 - 50 : f >= 0.0625 ? f * 160 - 70 : f > 0 ? f * 480 - 90 : -Infinity;

/** dB -> X32 fader (0-1) */
const db_to_x32_fader = (db) => db >= 10 ? 1 : db >= -10 ? (db + 30) / 40 : db >= -30 ? (db + 50) / 80 : db >= -60 ? (db + 70) / 160 : db > -90 ? (db + 90) / 480 : 0;

/** X32 fader -> the app's fader position (StudioLive law, 0-100) */
const position_from_x32 = (f) => f <= 0 ? 0 : level_to_fader(x32_fader_to_db(f));

/** The app's fader position (0-100) -> X32 fader */
const x32_from_position = (position) => position <= 0 ? 0 : db_to_x32_fader(fader_to_level_exact(position));

// #endregion

// #region Colors

// X32 scribble strip colors: 0 off, 1 red, 2 green, 3 yellow, 4 blue, 5 magenta, 6 cyan, 7 white;
// +8 is the inverted (dark) version
const X32_COLOR_NAMES = ["off", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];

/**
 * The nearest X32 color for "rrggbb": the hue from which channels are strong; dim colors
 * (e.g. dimmed DCAs) use the inverted version
 * @param {String} hex
 */
const x32_color = (hex) => {
	const [r, g, b] = (hex.replace(/^#/, "").match(/../g) ?? ["00", "00", "00"]).map((c) => parseInt(c, 16));
	const max = Math.max(r, g, b);
	if (max < 24) return 0;
	const on = (c) => c >= max * 0.6 ? 1 : 0;
	const index = [0, 1, 2, 3, 4, 5, 6, 7][on(r) * 1 + on(g) * 2 + on(b) * 4];
	// rgb bits -> X32 order: r=1 red, g=2 green, r+g=3 yellow, b=4 blue, r+b=5 magenta, g+b=6 cyan, all=7 white
	return index + (max < 128 ? 8 : 0);
}

// #endregion

// #region Channel settings (StudioLive names and 0-1 ranges <-> X32)

/**
 * Each stored setting the X32 can do: the X32 paths it uses, how to read it as a StudioLive
 * 0-1 value, and the X32 values to write for one
 * @param {Number} ch
 * @returns {Object<string, {paths: String[], read: Function, write: Function}>}
 */
const setting_map = (ch) => {
	const p = `/ch/${two(ch)}`;
	const headamp = `/headamp/${String(ch - 1).padStart(3, "0")}/gain`;   // the channel's local input
	const map = {
		// Gain: StudioLive 0 to 60 dB, X32 -12 to +60 dB
		'preampgain': {paths: [headamp],
			read: (v) => v[headamp] === undefined ? undefined : clamp01((v[headamp] * 72 - 12) / 60),
			write: (x) => [[headamp, clamp01((x * 60 + 12) / 72)]]},
		// HPF: StudioLive 24 Hz to 1 kHz (bottom = off), X32 on/off and 20 to 400 Hz
		'filter/hpf': {paths: [`${p}/preamp/hpon`, `${p}/preamp/hpf`],
			read: (v) => v[`${p}/preamp/hpon`] === undefined ? undefined : !v[`${p}/preamp/hpon`] ? 0
				: clamp01(Math.log((20 * Math.pow(20, v[`${p}/preamp/hpf`] ?? 0)) / 24) / Math.log(1000 / 24)) || 0.002,
			write: (x) => {
				const hz = UNITS.hpf_hz(x);
				if (hz === null) return [[`${p}/preamp/hpon`, int(0)]];
				return [[`${p}/preamp/hpf`, clamp01(Math.log(Math.min(400, Math.max(20, hz)) / 20) / Math.log(20))], [`${p}/preamp/hpon`, int(1)]];
			}},
		'eq/eqallon': {paths: [`${p}/eq/on`], read: (v) => v[`${p}/eq/on`], write: (x) => [[`${p}/eq/on`, int(x >= 0.5 ? 1 : 0)]]},
		'comp/on': {paths: [`${p}/dyn/on`], read: (v) => v[`${p}/dyn/on`], write: (x) => [[`${p}/dyn/on`, int(x >= 0.5 ? 1 : 0)]]},
		// Compressor threshold: StudioLive -56 to 0 dB, X32 -60 to 0 dB
		'comp/threshold': {paths: [`${p}/dyn/thr`],
			read: (v) => v[`${p}/dyn/thr`] === undefined ? undefined : clamp01((-60 + 60 * v[`${p}/dyn/thr`] + 56) / 56),
			write: (x) => [[`${p}/dyn/thr`, clamp01((UNITS.comp_db(x) + 60) / 60)]]},
		'gate/on': {paths: [`${p}/gate/on`], read: (v) => v[`${p}/gate/on`], write: (x) => [[`${p}/gate/on`, int(x >= 0.5 ? 1 : 0)]]},
		// Gate threshold: StudioLive -84 to 0 dB, X32 -80 to 0 dB
		'gate/threshold': {paths: [`${p}/gate/thr`],
			read: (v) => v[`${p}/gate/thr`] === undefined ? undefined : clamp01((-80 + 80 * v[`${p}/gate/thr`] + 84) / 84),
			write: (x) => [[`${p}/gate/thr`, clamp01((UNITS.gate_db(x) + 80) / 80)]]},
	};
	for (const band of [1, 2, 3, 4]) {
		const e = `${p}/eq/${band}`;
		// Type: StudioLive 1 = peaking, 0 = shelf (bands 1 and 4); X32 1 = low shelf, 2 = PEQ, 4 = high shelf
		map[`eq/eqtype${band}`] = {paths: [`${e}/type`],
			read: (v) => v[`${e}/type`] === undefined ? undefined : [1, 4].includes(v[`${e}/type`]) ? 0 : 1,
			write: (x) => [[`${e}/type`, int(x < 0.5 && band === 1 ? 1 : x < 0.5 && band === 4 ? 4 : 2)]]};
		// Gain: ±15 dB on both
		map[`eq/eqgain${band}`] = {paths: [`${e}/g`], read: (v) => v[`${e}/g`], write: (x) => [[`${e}/g`, clamp01(x)]]};
		// Frequency: StudioLive 36 Hz to 18 kHz, X32 20 Hz to 20 kHz (both log)
		map[`eq/eqfreq${band}`] = {paths: [`${e}/f`],
			read: (v) => v[`${e}/f`] === undefined ? undefined : clamp01(Math.log((20 * Math.pow(1000, v[`${e}/f`])) / 36) / Math.log(500)),
			write: (x) => [[`${e}/f`, clamp01(Math.log(UNITS.eq_hz(x) / 20) / Math.log(1000))]]};
		// Q: StudioLive 0.1 to 4, X32 10 down to 0.3 (both log)
		map[`eq/eqq${band}`] = {paths: [`${e}/q`],
			read: (v) => v[`${e}/q`] === undefined ? undefined : clamp01(Math.log((10 * Math.pow(0.03, v[`${e}/q`])) / 0.1) / Math.log(40)),
			write: (x) => [[`${e}/q`, clamp01(Math.log(Math.min(10, Math.max(0.3, UNITS.eq_q(x))) / 10) / Math.log(0.03))]]};
	}
	return map;
}

// #endregion

/**
 * An X32 that looks like the StudioLive API's Client to the rest of the app
 * Events: 'connected', 'closed', 'reconnecting', 'socketError', 'PV' {name, value}, 'meter' {0: levels}
 */
class X32Client extends EventEmitter {
	/**
	 * @param {{host: String, port?: Number}} target
	 * @param {{localAddress?: String}} [options]
	 */
	constructor({host, port}, options = {}) {
		super();
		this.kind = 'x32';
		this.host = host;
		this.port = Number(port) || X32_PORT;
		this.localAddress = options.localAddress;
		this.channelCounts = {LINE: LINES, DCA: DCAS, MAIN: 1};
		this.info = null;           // {ip, name, model, version} from /xinfo
		/** Last known value of each X32 path */
		this.values = {};
		this.socket = null;
		this.connected = false;
		this.lastReply = 0;
		this.timers = [];
		this.state = {get: (key) => this.get(key)};
		this.settings = Array.from({length: LINES}, (_, i) => setting_map(i + 1));
		/** X32 path -> [channel, StudioLive param] for change events */
		this.settingPaths = new Map();
		this.settings.forEach((map, i) => {
			for (const [param, {paths}] of Object.entries(map)) for (const path of paths) this.settingPaths.set(path, [i + 1, param]);
		});
	}

	// #region Connection

	/** Connect: resolves once the console answers /xinfo */
	connect() {
		if (this.connectPromise) return this.connectPromise;
		this.connectPromise = new Promise((resolve, reject) => {
			const socket = dgram.createSocket('udp4');
			this.socket = socket;
			socket.on('error', (error) => this.emit('socketError', error));
			socket.on('message', (packet, rinfo) => {
				if (rinfo.address !== this.host && this.host !== '255.255.255.255') return;
				this.receive(packet);
			});
			this.once('connected', () => resolve());
			socket.bind({port: 0, address: this.localAddress}, () => {
				this.send('/xinfo');
				this.timers.push(setInterval(() => this.heartbeat(), PING_MS));
			});
		});
		return this.connectPromise;
	}

	/** Ping, renew subscriptions, and notice when the console stops answering */
	heartbeat() {
		this.send('/xinfo');
		if (this.connected && Date.now() - this.lastReply > LOST_MS) {
			this.connected = false;
			this.emit('closed');
			this.emit('reconnecting');
		}
	}

	disconnect() {
		for (const timer of this.timers) clearInterval(timer);
		this.timers = [];
		this.connected = false;
		try { this.socket?.close(); } catch { /* already closed */ }
		this.socket = null;
	}

	/** First answer (or answer after losing the console): subscribe and read everything */
	came_up() {
		this.connected = true;
		this.send('/xremote');
		if (!this.remoteTimer) {
			this.remoteTimer = setInterval(() => this.connected && this.send('/xremote'), REMOTE_RENEW_MS);
			this.timers.push(this.remoteTimer);
		}
		this.request_all().then(() => this.emit('connected'));
	}

	/** Read every value the app uses, in small batches */
	async request_all() {
		const paths = [];
		for (let ch = 1; ch <= LINES; ch++) {
			const p = `/ch/${two(ch)}`;
			paths.push(`${p}/config/name`, `${p}/config/color`, `${p}/mix/fader`, `${p}/mix/on`, `${p}/grp/dca`, `${p}/grp/mute`,
				...Object.values(this.settings[ch - 1]).flatMap((s) => s.paths));
		}
		for (let d = 1; d <= DCAS; d++) paths.push(`/dca/${d}/config/name`, `/dca/${d}/config/color`, `/dca/${d}/fader`, `/dca/${d}/on`);
		for (let m = 1; m <= MUTE_GROUPS; m++) paths.push(`/config/mute/${m}`);
		paths.push('/main/st/config/name');
		const unique = [...new Set(paths)];
		for (let i = 0; i < unique.length; i += BATCH) {
			for (const path of unique.slice(i, i + BATCH)) this.send(path);
			await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
		}
		// Let the last answers arrive
		await new Promise((r) => setTimeout(r, 300));
	}

	/**
	 * Send an OSC message
	 * @param {String} address
	 * @param {...*} args see osc.encode
	 */
	send(address, ...args) {
		if (!this.socket) return;
		this.socket.send(encode(address, ...args), this.port, this.host, (error) => {
			if (error) this.emit('socketError', error);
		});
	}

	/**
	 * Set an X32 value: send it and remember it (the X32 doesn't echo our own changes back)
	 * @param {String} path
	 * @param {Number | String | {type: 'i', value: Number}} arg
	 */
	set(path, arg) {
		this.values[path] = typeof arg === 'object' ? arg.value : arg;
		this.send(path, arg);
	}

	// #endregion

	// #region Incoming

	receive(packet) {
		const message = decode(packet);
		if (!message) return;
		this.lastReply = Date.now();
		const {address, args} = message;

		if (address === '/xinfo') {
			const [ip, name, model, version] = args;
			this.info = {ip, name, model, version};
			if (!this.connected) this.came_up();
			return;
		}
		if (address === '/meters/1') return this.receive_meters(args[0]);
		if (!args.length) return;

		const old = this.values[address];
		this.values[address] = args[0];
		if (old === args[0]) return;
		this.announce(address);
	}

	/** Tell the app about a change made on the console, as a StudioLive-style PV event */
	announce(address) {
		const v = this.values[address];
		let m;
		if ((m = /^\/ch\/(\d\d)\/mix\/on$/.exec(address))) this.emit('PV', {name: `line/ch${Number(m[1])}/mute`, value: !v});
		else if ((m = /^\/ch\/(\d\d)\/mix\/fader$/.exec(address))) this.emit('PV', {name: `line/ch${Number(m[1])}/volume`, value: position_from_x32(v) / 100});
		else if ((m = /^\/dca\/(\d)\/on$/.exec(address))) this.emit('PV', {name: `filtergroup/ch${m[1]}/mute`, value: !v});
		else if ((m = /^\/dca\/(\d)\/fader$/.exec(address))) this.emit('PV', {name: `filtergroup/ch${m[1]}/volume`, value: position_from_x32(v) / 100});
		else if ((m = /^\/config\/mute\/(\d)$/.exec(address))) this.emit('PV', {name: `mutegroup/mutegroup${m[1]}`, value: v ? 1 : 0});
		else if (this.settingPaths.has(address)) {
			const [ch, param] = this.settingPaths.get(address);
			const value = this.settings[ch - 1][param].read(this.values);
			if (value !== undefined) this.emit('PV', {name: `line/ch${ch}/${param}`, value: Number(value)});
		}
	}

	/** /meters/1: 32 input levels (then gate and compressor gain reduction), little-endian floats, 1.0 = 0 dBFS */
	receive_meters(blob) {
		if (!Buffer.isBuffer(blob) || blob.length < 4 + LINES * 4) return;
		const count = Math.min(blob.readInt32LE(0), (blob.length - 4) / 4);
		const levels = [];
		for (let i = 0; i < Math.min(LINES, count); i++) levels.push(Math.round(clamp01(blob.readFloatLE(4 + i * 4)) * 65535));
		// Same shape as the StudioLive's meter frames: group 0 = line channels, 65535 = 0 dBFS
		this.emit('meter', {0: levels});
	}

	// #endregion

	// #region StudioLive Client methods

	/** Ask for input meters (renewed before the X32's 10 s subscription runs out) */
	async meterSubscribe() {
		const ask = () => this.connected && this.send('/meters', '/meters/1');
		ask();
		this.timers.push(setInterval(ask, METER_RENEW_MS));
	}

	/**
	 * A StudioLive-style parameter, from the X32's values
	 * @param {String} key e.g. "line/ch3/mute", "filtergroup/ch1/line3", "line/ch3/eq/eqgain1"
	 */
	get(key) {
		const v = this.values;
		let m;
		if (key === 'global.mixer_version') return this.info?.version;
		if ((m = /^line\/ch(\d+)\/username$/.exec(key))) return v[`/ch/${two(m[1])}/config/name`];
		if ((m = /^line\/ch(\d+)\/mute$/.exec(key))) return v[`/ch/${two(m[1])}/mix/on`] === undefined ? undefined : !v[`/ch/${two(m[1])}/mix/on`];
		if ((m = /^filtergroup\/ch(\d+)\/mute$/.exec(key))) return v[`/dca/${m[1]}/on`] === undefined ? undefined : !v[`/dca/${m[1]}/on`];
		if ((m = /^filtergroup\/ch(\d+)\/name$/.exec(key))) return v[`/dca/${m[1]}/config/name`];
		if ((m = /^filtergroup\/ch(\d+)\/line(\d+)$/.exec(key))) return Boolean((v[`/ch/${two(m[2])}/grp/dca`] ?? 0) & (1 << (Number(m[1]) - 1)));
		if ((m = /^mutegroup\/mutegroup(\d+)$/.exec(key))) return v[`/config/mute/${m[1]}`];
		if ((m = /^mutegroup\/mutegroup(\d+)username$/.exec(key))) return Number(m[1]) <= MUTE_GROUPS ? `Mute Group ${m[1]}` : undefined;
		// Members as a StudioLive-style string, one character per channel
		if ((m = /^mutegroup\/mutegroup(\d+)mutes$/.exec(key))) {
			if (Number(m[1]) > MUTE_GROUPS) return undefined;
			return Array.from({length: LINES}, (_, i) => ((v[`/ch/${two(i + 1)}/grp/mute`] ?? 0) >> (Number(m[1]) - 1)) & 1 ? "1" : "0").join("");
		}
		if ((m = /^line\/ch(\d+)\/(.+)$/.exec(key)) && Number(m[1]) <= LINES) return this.settings[Number(m[1]) - 1][m[2]]?.read(v);
		return undefined;
	}

	/** Fader position (0-100, StudioLive law) */
	getLevel({type, channel}) {
		const f = this.values[type === 'DCA' ? `/dca/${channel}/fader` : `/ch/${two(channel)}/mix/fader`];
		return typeof f === 'number' ? position_from_x32(f) : undefined;
	}

	/** Set a fader from a position (0-100, StudioLive law) */
	async setChannelVolumeLinear({type, channel}, position) {
		this.set(type === 'DCA' ? `/dca/${channel}/fader` : `/ch/${two(channel)}/mix/fader`, x32_from_position(position));
	}

	mute(selector) { this.set_on(selector, 0); }
	unmute(selector) { this.set_on(selector, 1); }
	set_on({type, channel}, on) {
		this.set(type === 'DCA' ? `/dca/${channel}/on` : `/ch/${two(channel)}/mix/on`, int(on));
	}

	/** Scribble strip name (the X32 shows 12 characters) */
	setName({type, channel}, name) {
		const text = String(name ?? "").slice(0, NAME_LENGTH);
		this.set(type === 'DCA' ? `/dca/${channel}/config/name` : type === 'MAIN' ? '/main/st/config/name' : `/ch/${two(channel)}/config/name`, text);
	}

	/** Scribble strip color, the nearest of the X32's eight */
	setColor({type, channel}, hex) {
		this.set(type === 'DCA' ? `/dca/${channel}/config/color` : `/ch/${two(channel)}/config/color`, int(x32_color(hex)));
	}

	/**
	 * Put exactly these lines on a DCA (of the lines the app manages)
	 * @param {{channel: Number}} selector the DCA
	 * @param {Number[]} channels
	 * @param {Number[]} [managed] the lines to take off it if they aren't in channels
	 */
	assign_dca({channel: dca}, channels, managed = null) {
		const bit = 1 << (dca - 1);
		for (const ch of managed ?? Array.from({length: LINES}, (_, i) => i + 1)) {
			if (ch < 1 || ch > LINES) continue;
			const path = `/ch/${two(ch)}/grp/dca`;
			const before = this.values[path] ?? 0;
			const after = channels.includes(ch) ? before | bit : before & ~bit;
			if (after !== before || this.values[path] === undefined) this.set(path, int(after));
		}
	}

	/**
	 * The StudioLive API's raw parameter writes, as the app uses them: line settings (PV),
	 * mute group reset (PV), the main fader's name (PS). Anything else has no X32 match.
	 * @param {String} code 'PV' | 'PS' | ...
	 * @param {Buffer} data key, "\0\0\0", then a little-endian float (PV) or a string (PS)
	 */
	_sendPacket(code, data) {
		if (code !== 'PV' && code !== 'PS') return;
		const text = data.toString('latin1');
		const key = text.slice(0, text.indexOf("\0"));
		let m;
		if (code === 'PS') {
			const value = data.subarray(key.length + 3).toString('utf8').replace(/\0+$/, "");
			if (key === 'main/ch1/username') this.setName({type: 'MAIN'}, value);
			return;
		}
		const value = data.readFloatLE(data.length - 4);
		if ((m = /^mutegroup\/mutegroup(\d+)$/.exec(key)) && Number(m[1]) <= MUTE_GROUPS) this.set(`/config/mute/${m[1]}`, int(value >= 0.5 ? 1 : 0));
		else if ((m = /^line\/ch(\d+)\/(.+)$/.exec(key)) && Number(m[1]) <= LINES) {
			for (const [path, arg] of this.settings[Number(m[1]) - 1][m[2]]?.write(value) ?? []) this.set(path, arg);
		}
	}

	/** The state snapshot the app compares after a reconnect, StudioLive-shaped */
	dumpState() {
		const filtergroup = {}, line = {};
		for (let d = 1; d <= DCAS; d++) {
			filtergroup[`ch${d}`] = {name: this.values[`/dca/${d}/config/name`] ?? ""};
			for (let ch = 1; ch <= LINES; ch++) filtergroup[`ch${d}`][`line${ch}`] = this.get(`filtergroup/ch${d}/line${ch}`);
		}
		for (let ch = 1; ch <= LINES; ch++) line[`ch${ch}`] = {username: this.values[`/ch/${two(ch)}/config/name`] ?? ""};
		return {internal: {filtergroup, line}};
	}

	// #endregion
}

/**
 * Parse an /xinfo answer (discovery)
 * @param {Buffer} packet
 * @returns {{model: String, name: String, serial: String, version: String, kind: 'x32'} | null}
 */
const parse_x32_info = (packet) => {
	const message = decode(packet);
	if (message?.address !== '/xinfo' || message.args.length < 3) return null;
	const [ip, name, model, version] = message.args.map(String);
	// The X32 has no serial number over OSC: its network name stands in (auto-connect matches it)
	return {model, name: name || model, serial: `x32:${name || ip}`, version, kind: 'x32'};
}

const XINFO_REQUEST = encode('/xinfo');

export { X32Client, X32_PORT, XINFO_REQUEST, parse_x32_info, x32_fader_to_db, db_to_x32_fader, x32_color };
