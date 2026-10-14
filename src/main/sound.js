import { app, BrowserWindow, ipcMain } from 'electron';
import dgram from 'node:dgram';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { EventEmitter } from 'node:events';

import { Client } from '@featherbear/presonus-studiolive-api';
import {getShow} from './showManager.js';
import {attachConsoleButtons, detachConsoleButtons, syncConsoleButtons} from './consoleButtons.js';
import {debugLog} from './debugLog.js';
import {getSettings, updateSettings} from './settings.js';
import {attachChannelMonitor, detachChannelMonitor, resetChannelMonitor, setMonitoredChannels, setActiveChannels} from './channelMonitor.js';
import {get_dca_level, fader_to_level, fader_to_level_exact, level_to_fader, format_dca_level, NEW_DCA_LEVEL} from '../utils/dca_levels.js';
import {next_cue, dca_next_state, color_blind_state} from '../utils/dca_state.js';
import {parse_map, default_profile, profile_flags, SETTING_SECTIONS, show_dcas} from '../utils/show_edits.js';
import {format_cue_number} from '../utils/cue_number.js';

import {convert_ip_to_octets, is_ip_valid} from '../utils/ip_tools';
import Actor from '../models/Actor.js';
import Profile from '../models/Profile.js';

// DCA colors, like TheatreMix's DCA color coding (theatremix.com/features#dcaColours):
// each DCA shows what happens to it in the NEXT cue. (Line channel colors come from
// channelMonitor.js.)
const DCA_COLORS = {
	change: "ffffff",    // white: the DCA's channels change in the next cue (fader down before Go)
	same: "00ff00",      // green: exactly the same in the next cue (safe to Go with the fader up)
	position: "00ffff",  // cyan: same channels, but one changes position
	fx: "ff8000",        // orange: same channels, but one changes FX
	profile: "ffff00",   // yellow: same channels, but one changes profile
	ensemble: "ff00ff",  // magenta: channels move in and out of ensemble (multi-channel) DCAs
	off: "000000",       // black: nothing assigned to the DCA
	dimmed: "0000ff",    // blue: fader at -∞ with "dim DCA faders" + "suppress colors" on
};
// With "dim DCA faders" on (and colors not suppressed), a DCA at -∞ shows its color this bright
const DIM_FACTOR = 0.25;
// Fader positions (0-100) at or below this count as -∞
const DIM_FADER = 0.5;

// Global Presonus Client Object
/** @type {Client} */
let presonusClient = null; 

const CONTROLLED_LINES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]

// The most DCAs a show can use (Show Setup → "Use all 24 DCAs")
const MAX_SHOW_DCAS = 24;

// UCNet ports. Consoles broadcast a "DA" announce packet from CONTROL_PORT to
// 255.255.255.255:DISCOVERY_PORT roughly every 2.5 seconds.
const CONTROL_PORT = 53000;
const DISCOVERY_PORT = 47809;
const DEFAULT_DISCOVERY_TIMEOUT = 10000;

// The query Universal Control broadcasts to find consoles ("NO"); consoles answer with
// their "DA" announcement straight back to the sender
const DISCOVERY_PROBE = Buffer.from('5543000100004e4f00000000', 'hex');
const DISCOVERY_PROBE_INTERVAL = 3000;

// How long a single TCP attempt may take, and how long we keep retrying before giving up
const CONNECT_ATTEMPT_TIMEOUT = 5000;
const CONNECT_DEADLINE = 15000;

/** @type {Cue} */
let current_cue = null;

/** @type {Promise<{ok: boolean, error?: string}>} */
let pending_connect = null;

/**
 * Console connection status (shown on the toolbar's Console Setup icon)
 * @typedef {Object} ConsoleStatus
 * @property {'disconnected' | 'connecting' | 'connected'} state
 * @property {String} [host]
 * @property {String} [name] console name from discovery
 * @property {String} [message] e.g. why it disconnected
 */

/** @type {ConsoleStatus} */
let console_status = {state: 'disconnected'};

const consoleEvents = new EventEmitter();

/**
 * Update the connection status and tell every window
 * @param {ConsoleStatus} status 
 */
const set_console_status = (status) => {
	console_status = status;
	consoleEvents.emit('status', status);

	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) window.webContents.send('console-status', status);
	}
}

const get_console_status = () => console_status;

/** @type {Promise<{devices: Object[], error?: string}>} */
let pending_discovery = null;

/** 'found' (device) as soon as discovery hears a new console */
const discoveryEvents = new EventEmitter();

// Auto-connect on launch: how long to look for the last console
const AUTO_CONNECT_TIMEOUT = 10000;

/**
 * What was last written to each DCA, so unchanged DCAs aren't touched
 * @type {Object<number, {channels: String, label: String}>}
 */
let applied_dcas = {};

/** What was fired last, so it can be re-applied if the console comes back changed */
let last_fired = null; // {type: 'cue', cue} | {type: 'linecheck'}

/**
 * Line usernames last written to the console, so unchanged names aren't resent
 * @type {Object<number, String>}
 */
let line_names = {};

/**
 * The DCA fader position each line channel (person) was last mixed at, so their offset
 * follows them when they move to a different DCA. Read from the console's live faders before
 * every cue, so the operator's fader moves are kept.
 * @type {Map<number, number>} channel -> fader position (0-100)
 */
let channel_levels = new Map();

/**
 * DCA fader positions (0-100) since connecting: moves made on the console and levels we sent.
 * Kept here because the API's own state mixes scales: its connection snapshot and its own
 * writes are 0-100, but fader moves from the console are stored as 0-1.
 * @type {Map<number, number>} DCA -> fader position
 */
let dca_faders = new Map();

/**
 * DCA mutes since connecting (on = muted): mutes made on the console and ones we sent.
 * Kept here because the API doesn't record its own mute sends in its state.
 * @type {Map<number, boolean>}
 */
let dca_mutes = new Map();

/**
 * Line mutes since connecting (on = muted), kept for the same reason as dca_mutes
 * @type {Map<number, boolean>}
 */
let line_mutes = new Map();

/**
 * Line faders: a line coming onto a DCA (from being on none) starts at 0 dB plus its level
 * offset (Assign → Offset, when Show Setup → "Store level offsets" is on). While it stays on a
 * DCA, even moving between DCAs, the operator's trim is kept; an offset change moves the fader
 * by the difference.
 * line_placed: main channel -> the line carrying it and the offset applied, while it's on a DCA.
 * line_faders: line fader positions (0-100) since connecting.
 * @type {Map<number, {live: Number, offset: Number}>}
 */
let line_placed = new Map();
let line_faders = new Map();

// A backup takes over its main's fader level within this range, else 0 dB plus the offset
const COPY_LEVEL_MIN_DB = -30;
const COPY_LEVEL_MAX_DB = 6;

/**
 * Backup channels (TheatreMix: Show Setup → Backup, "backupChannels" = "backup=main", and a
 * spare backup channel). A main channel switched to its backup has its DCA assignments, name
 * (with a ~) and unmute moved to the backup; the main is muted. Switched by pressing the DCA's
 * mute button on the console, or double-clicking it in the cue list's backup tray.
 * @type {Set<number>} main channels using their backup
 */
let switched = new Set();
/** @type {number | null} main channel the spare backup is standing in for */
let spare_for = null;

/**
 * Stored channel settings (TheatreMix's profiles: Store Gain / HPF / EQ / Dyn): the StudioLive
 * line parameters in each section (0-1, as the console sends them)
 */
const SETTING_PARAMS = {
	gain: ['preampgain', 'digitalgain'],
	hpf: ['filter/hpf'],
	eq: ['eq/eqallon', ...[1, 2, 3, 4].flatMap((b) => ['eqtype', 'eqgain', 'eqq', 'eqfreq', 'eqbandon', 'eqbandop'].map((p) => `eq/${p}${b}`))],
	dyn: ['comp/on', 'comp/softknee', 'comp/automode', 'comp/threshold', 'comp/ratio', 'comp/attack', 'comp/release', 'comp/gain', 'comp/kneewidth',
		'gate/on', 'gate/expander', 'gate/threshold', 'gate/range', 'gate/attack', 'gate/release', 'gate/ratio',
		'limit/limiteron', 'limit/threshold', 'limit/release'],
};
const SETTING_PARAM = new RegExp(`^line/ch(\\d+)/(${Object.values(SETTING_PARAMS).flat().join("|")})$`);

/** Line parameter values we've seen or sent since connecting ("line/ch3/eq/eqgain1" -> 0.5) */
let param_values = new Map();
/** What each line was last sent: channel -> {section: JSON of the values} */
let applied_settings = new Map();

/**
 * DCA mutes we sent recently: the console may echo them, and they mustn't look like presses
 * @type {Map<number, {muted: boolean, at: number}>}
 */
const sent_dca_mutes = new Map();
const ECHO_MS = 1500;

/**
 * Each cue's DCAs as they were when it was last left: {channels, fader, muted} per DCA,
 * so going Back into a cue puts its faders and mutes back
 * @type {Map<string, Map<number, {channels: String, fader: Number | null, muted: Boolean | null}>>}
 */
let cue_snapshots = new Map();

/**
 * Color last sent to each DCA, so unchanged colors aren't resent
 * @type {Map<number, string>}
 */
let dca_colors = new Map();

/** Last time a DCA fader move from the console was logged, per DCA */
const fader_move_logged = new Map();


/**
 * Parse a UCNet "DA" discovery announcement
 * Layout: "UC\0\x01" + 2 bytes + "DA" + 4 C-bytes + 20 bytes + null separated strings
 *         (model, device class, serial, friendly name)
 * @param {Buffer} packet
 * @returns {{model: String, serial: String, name: String} | null}
 */
const parse_discovery_packet = (packet) => {
	if (packet.length < 32 || packet.subarray(0, 4).toString('latin1') !== "UC\0\x01") return null;
	if (packet.subarray(6, 8).toString() !== "DA") return null;

	const [model, _device_class, serial, name] = packet.subarray(32).toString('utf8').split("\0");
	if (!serial) return null;

	return {model, serial, name: name || model};
}

/**
 * Handle Presonus Discovery
 * Listens for console announcements and streams each one to the renderer as it is found.
 * @param {Event} event
 * @param {Number} timeout in ms
 * @returns {Promise<{devices: Object[], error?: String}>} discovered devices
 * @async
 */
const discover = async (event, {timeout}) => {
	// Only one discovery socket at a time; extra callers share the running scan
	if (pending_discovery !== null) {
		return pending_discovery;
	}

	if (!Number.isFinite(timeout) || timeout <= 0) {
		timeout = DEFAULT_DISCOVERY_TIMEOUT;
	}

	console.log(`[SOUND:discover]: Discovering PreSonus Consoles on the Network for ${timeout}ms`);

	pending_discovery = new Promise((resolve) => {
		const devices = new Map();
		const sockets = [];
		let finished = false;
		let timer = null;
		let probe_timer = null;
		let listener_error = null;

		const finish = (error) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			clearInterval(probe_timer);
			for (const s of sockets) {
				try { s.close(); } catch {}
			}
			pending_discovery = null;

			// Only report the listener's error if nothing was found another way
			const reported = devices.size === 0 ? (error ?? listener_error) : error;
			debugLog('DISCOVERY', `Finished: ${devices.size} console(s) found`, reported ?? "");
			resolve({devices: [...devices.values()], error: reported ?? undefined});
		}

		/**
		 * A "DA" announcement arrived (on the shared port, or as a reply to our probe)
		 * @param {String} via which socket received it, for the log
		 */
		const handle_message = (packet, rinfo, via) => {
			const parsed = parse_discovery_packet(packet);
			if (parsed === null) return;

			const is_new = !devices.has(parsed.serial);
			const device = {
				...parsed,
				ip: rinfo.address,
				port: CONTROL_PORT,
				timestamp: new Date().toLocaleTimeString(),
			};
			devices.set(parsed.serial, device);

			if (is_new) {
				debugLog('DISCOVERY', `Found "${device.name}" (${device.model}, serial ${device.serial}) at ${device.ip}, via ${via}`);
				if (event?.sender && !event.sender.isDestroyed()) {
					event.sender.send('presonus:device-found', device);
				}
				discoveryEvents.emit('found', device);
			}
		}

		// 1) Shared discovery port: consoles broadcast an announcement here every few seconds.
		//    Universal Control listens here too; broadcasts reach everyone, but a direct
		//    (unicast) announcement only reaches one of the listening apps.
		const listener = dgram.createSocket({type: 'udp4', reuseAddr: true});
		sockets.push(listener);
		listener.on('error', (err) => {
			debugLog('DISCOVERY', `Can't listen on port ${DISCOVERY_PORT} (${err.code ?? err.message}); relying on probes`);
			listener_error = err.code === 'EADDRINUSE'
				? `Discovery port ${DISCOVERY_PORT} is in use by another app (likely Universal Control). Quit it and rescan.`
				: `Discovery failed: ${err.code ?? err.message}`;
			try { listener.close(); } catch {}
		});
		listener.on('message', (packet, rinfo) => handle_message(packet, rinfo, `port ${DISCOVERY_PORT}`));
		listener.bind(DISCOVERY_PORT, '0.0.0.0', () => {
			listener.setBroadcast(true);
			debugLog('DISCOVERY', `Listening on port ${DISCOVERY_PORT}`);
		});

		// 2) Probe from every network adapter, like Universal Control: broadcast a "NO" query
		//    and take the replies on that adapter's own socket.
		const probes = [];
		for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
			for (const addr of addrs ?? []) {
				if (addr.family !== 'IPv4' || addr.internal) continue;

				const probe = dgram.createSocket({type: 'udp4'});
				sockets.push(probe);
				probe.on('error', (err) => debugLog('DISCOVERY', `Probe socket on ${iface} (${addr.address}) failed: ${err.code ?? err.message}`));
				probe.on('message', (packet, rinfo) => handle_message(packet, rinfo, `probe on ${iface}`));
				probe.bind(0, addr.address, () => {
					probe.setBroadcast(true);
					probes.push({probe, iface, address: addr.address});
				});
			}
		}

		const send_probes = () => {
			for (const {probe, iface, address} of probes) {
				probe.send(DISCOVERY_PROBE, DISCOVERY_PORT, '255.255.255.255', (err) => {
					if (err) debugLog('DISCOVERY', `Probe from ${iface} (${address}) failed: ${err.code ?? err.message}`);
				});
			}
		}

		// Give the sockets a moment to bind, then probe every few seconds while scanning
		setTimeout(() => {
			if (finished) return;
			debugLog('DISCOVERY', `Probing from ${probes.length} adapter(s): ${probes.map((p) => `${p.iface} ${p.address}`).join(", ") || "none"}`);
			send_probes();
			probe_timer = setInterval(send_probes, DISCOVERY_PROBE_INTERVAL);
		}, 200);

		timer = setTimeout(() => finish(), timeout);
	});

	return pending_discovery;
}

/**
 * Find the local IPv4 address on the same subnet as the console.
 * Binding to it stops macOS from sending link-local (169.254.x.x) traffic out of the
 * wrong interface (e.g. Wi-Fi) when the console is plugged into Ethernet.
 * @param {String} host console IP
 * @returns {String | undefined} local address
 */
const find_local_address = (host) => {
	const to_int = (ip) => ip.split(".").reduce((acc, oct) => ((acc << 8) | parseInt(oct)) >>> 0, 0);
	const host_int = to_int(host);
	const matches = [];

	for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
		for (const addr of addrs ?? []) {
			if (addr.family !== 'IPv4' || addr.internal) continue;

			const mask = to_int(addr.netmask);
			if ((to_int(addr.address) & mask) === (host_int & mask)) {
				matches.push({iface, address: addr.address});
			}
		}
	}

	if (matches.length === 0) {
		console.warn(`[SOUND:connect]: No network interface is on the same subnet as ${host}. Check the cable / IP settings.`);
		return undefined;
	}

	if (matches.length > 1) {
		console.warn(`[SOUND:connect]: Multiple interfaces are on ${host}'s subnet, using the first:`, matches);
	}

	console.log(`[SOUND:connect]: Using local interface ${matches[0].iface} (${matches[0].address})`);
	return matches[0].address;
}

/**
 * Human readable explanation for a socket error code
 * @param {Error} err
 * @returns {String}
 */
const describe_socket_error = (err) => {
	switch (err?.code) {
		case 'EHOSTUNREACH':
		case 'ENETUNREACH':
			return `${err.code}: macOS could not reach the console. Allow this app (or Terminal/VS Code when running "npm start") under System Settings → Privacy & Security → Local Network.`;
		case 'ECONNREFUSED':
			return `${err.code}: The console refused the connection. It may have too many remote clients connected.`;
		case 'ETIMEDOUT':
			return `${err.code}: No response from the console. Check the IP address and that it is on the same network.`;
		case 'EADDRNOTAVAIL':
			return `${err.code}: The local network interface went away. Check the cable.`;
		default:
			return err ? `${err.code ?? ""} ${err.message}` : "Unknown error";
	}
}


/**
 * Connect to Console
 * @param {Event} _event 
 * @param {String} host 
 * @param {int} port
 * @returns {Promise<{ok: boolean, error?: String}>} connection result
 * @async
 */
const connect = async (_event, {host, port, name, serial}) => {
	// Ignore repeat clicks while an attempt is already running
	if (pending_connect !== null) {
		console.log("[SOUND:connect]: Connection attempt already in progress");
		return pending_connect;
	}

	port = Number(port) || CONTROL_PORT;
	pending_connect = do_connect(host, port, name).then((result) => {
		// Remember it for auto-connect on the next launch
		if (result?.ok) updateSettings({lastConsole: {host, port, name: name ?? null, serial: serial ?? null}});
		return result;
	}).finally(() => {
		pending_connect = null;
	});

	return pending_connect;
}

/**
 * On launch (Console Setup → "Connect automatically"): look for the console we were last
 * connected to and connect to it if it's there. Matched by serial, so it's found even if
 * its IP address changed.
 * @param {Electron.WebContents} [sender] window that shows discovered consoles
 */
const auto_connect = async (sender) => {
	const {autoConnect, lastConsole} = getSettings();
	if (!autoConnect) {
		debugLog('AUTOCONNECT', "Off (Console Setup)");
		return;
	}
	if (!lastConsole?.host) {
		debugLog('AUTOCONNECT', "No console connected before, nothing to reconnect to");
		return;
	}

	const label = `"${lastConsole.name ?? lastConsole.host}"${lastConsole.serial ? ` (serial ${lastConsole.serial})` : ""}`;
	debugLog('AUTOCONNECT', `Looking for the last console ${label}, last at ${lastConsole.host}`);
	set_console_status({state: 'connecting', host: lastConsole.host, name: lastConsole.name, message: "Looking for the last console"});

	const matches = (device) => lastConsole.serial ? device.serial === lastConsole.serial : device.ip === lastConsole.host;
	const found = await new Promise((resolve) => {
		let done = false;
		const finish = (device) => {
			if (done) return;
			done = true;
			discoveryEvents.off('found', on_found);
			resolve(device);
		};
		const on_found = (device) => { if (matches(device)) finish(device); };

		discoveryEvents.on('found', on_found);
		discover({sender}, {timeout: AUTO_CONNECT_TIMEOUT})
			.then(({devices}) => finish(devices.find(matches) ?? null));
	});

	// Connected by hand in the meantime
	if (presonusClient !== null || pending_connect !== null) return;

	if (!found) {
		debugLog('AUTOCONNECT', `${label} wasn't found within ${AUTO_CONNECT_TIMEOUT / 1000}s; not connecting`);
		set_console_status({state: 'disconnected', message: `Last console ${label} not found`});
		return;
	}

	debugLog('AUTOCONNECT', `Found ${label} at ${found.ip}; connecting`);
	return connect(null, {host: found.ip, port: found.port, name: found.name, serial: found.serial});
}

/**
 * Tear down the current client so it stops reconnecting in the background
 */
const disconnect = (message) => {
	if (presonusClient === null) return;

	console.log("[SOUND:disconnect]: Disconnecting from Sound Board.");
	detachConsoleButtons();
	detachChannelMonitor();
	presonusClient.disconnect();
	presonusClient = null;

	set_console_status({state: 'disconnected', ...(typeof message === 'string' ? {message} : {})});
}

/**
 * @param {String} host
 * @param {Number} port
 * @param {String} [name] console name, for the status tooltip
 * @returns {Promise<{ok: boolean, error?: String}>}
 */
const do_connect = async (host, port, name) => {
	console.log(`[SOUND:connect]: Connecting to Sound Board at ip address: ${host} on port ${port}.`);

	// Only ever keep one client alive, otherwise old ones keep reconnecting forever
	disconnect();

	set_console_status({state: 'connecting', host, name});

	const client = new Client({host: host, port: port}, {
		autoreconnect: true,
		logLevel: "debug",
		connectTimeout: CONNECT_ATTEMPT_TIMEOUT,
		localAddress: find_local_address(host),
	});
	presonusClient = client;
	dca_faders = new Map();
	dca_mutes = new Map();
	line_mutes = new Map();
	line_placed = new Map();
	line_faders = new Map();
	param_values = new Map();
	applied_settings = new Map();

	// Console mute group buttons as Go / Back
	attachConsoleButtons(client);

	// Line channel colors from the meters (blue silent / white signal / yellow in cue)
	setMonitoredChannels(getShow(), CONTROLLED_LINES);
	attachChannelMonitor(client);

	// Log DCA fader moves made on the console (at most once a second per DCA), so the log
	// shows the levels that will follow people to their next DCA
	client.on('PV', ({name, value}) => {
		// DCA muted / unmuted on the console
		const mute = /^filtergroup\/ch(\d+)\/mute$/.exec(name);
		if (mute && typeof value === 'boolean') {
			const dca = Number(mute[1]);
			dca_mutes.set(dca, value);
			const sent = sent_dca_mutes.get(dca);
			const echo = sent && sent.muted === value && Date.now() - sent.at < ECHO_MS;
			if (value && !echo) dca_mute_pressed(dca);
			return;
		}

		// Line muted / unmuted on the console
		const line_mute = /^line\/ch(\d+)\/mute$/.exec(name);
		if (line_mute && typeof value === 'boolean') {
			line_mutes.set(Number(line_mute[1]), value);
			return;
		}

		// A line's gain / HPF / EQ / dynamics changed on the console (for "store from console").
		// The library only converts parameters it knows; the rest arrive as the raw float.
		if (SETTING_PARAM.test(name)) {
			const number = Buffer.isBuffer(value) && value.length >= 4 ? value.readFloatLE(0)
				: typeof value === 'boolean' ? (value ? 1 : 0) : Number(value);
			if (Number.isFinite(number)) param_values.set(name, number);
			return;
		}

		// Line fader moved on the console (PV volumes are 0-1)
		const line_volume = /^line\/ch(\d+)\/volume$/.exec(name);
		if (line_volume && typeof value === 'number') {
			line_faders.set(Number(line_volume[1]), value * 100);
			return;
		}

		const match = /^filtergroup\/ch(\d+)\/volume$/.exec(name);
		if (!match || typeof value !== 'number') return;

		const dca = Number(match[1]);
		// PV volumes are 0-1
		dca_faders.set(dca, value * 100);
		// A fader pulled to (or up from) -∞ can change the DCA's dimmed color
		update_dca_color(dca);

		const now = Date.now();
		if (now - (fader_move_logged.get(dca) ?? 0) < 1000) return;
		fader_move_logged.set(dca, now);

		debugLog('LEVELS', `DCA ${dca} fader moved on the console -> ${format_dca_level(fader_to_level(value * 100))}`);
	});

	let last_error = null;

	client.on('socketError', (err) => {
		// Keep the more specific error if a timeout follows it
		if (err.code !== 'ETIMEDOUT' || last_error === null) {
			last_error = err;
		}
		console.warn(`[SOUND:connect]: ${describe_socket_error(err)}`);
	});

	let ever_connected = false;

	client.on('connected', () => {
		console.log("Connected to the device!");
		set_console_status({state: 'connected', host, name});

		// (Re)check the mute group buttons each time the connection comes up
		syncConsoleButtons(getShow());

		if (!ever_connected) {
			// Fresh connection: forget what was written before, then put the active cue on the
			// console (Line Checks until a cue is fired: actors' names, DCAs cleared)
			reset_console_state();
			apply_active_cue();
		} else {
			// Line names for where we are (Line Checks shows actors, cues show characters)
			if (last_fired?.type === 'linecheck') set_soundcheck_labels(); else init_channels();
		}

		// Reconnected (network blip or console reboot): make sure the console still matches
		if (ever_connected) {
			// Faders may have moved while we were away: the fresh snapshot has them.
			// The console may also have been reset, so resend the DCA colors.
			dca_faders = new Map();
			dca_mutes = new Map();
			line_mutes = new Map();
			line_faders = new Map();
			line_placed = new Map();
			dca_colors = new Map();
			resync_after_reconnect(client);

			// The meter subscription belongs to the old connection: ask for meters again on
			// the same port, and re-send the channel colors in case the console was reset
			if (client.meteringClient) {
				const port = client.meteringClient.address().port;
				const portBytes = Buffer.alloc(2);
				portBytes.writeUInt16LE(port);
				client._sendPacket('UM', portBytes, 0);
				debugLog('METERS', `Reconnected: asked for meters again on port ${port}`);
			}
			resetChannelMonitor();
		}
		ever_connected = true;
	})

	client.on('reconnecting', () => {
		console.log("Reconnecting!")
		set_console_status({state: 'connecting', host, name, message: "Connection lost, reconnecting"});
	})
	// Connection dropped: the client reconnects by itself, and the toolbar's Console
	// Setup icon turns amber until it's back. (No modal dialog: a blocking error box
	// froze the whole app, including the reconnect, until someone clicked OK.)
	client.on('closed', () => {
		console.warn("[SOUND:connect]: Lost connection to the console, reconnecting");
		set_console_status({state: 'connecting', host, name, message: "Connection lost, reconnecting"});
	})



	let deadline_timer;
	const deadline = new Promise((resolve) => {
		deadline_timer = setTimeout(() => resolve(false), CONNECT_DEADLINE);
	});

	const connected = await Promise.race([client.connect().then(() => true), deadline]);
	clearTimeout(deadline_timer);

	// Another connect replaced this client while we were waiting
	if (presonusClient !== client) {
		return {ok: false, error: "Connection was replaced by a newer attempt."};
	}

	if (!connected) {
		const error = describe_socket_error(last_error ?? {code: 'ETIMEDOUT'});
		console.warn(`[SOUND:connect]: Giving up after ${CONNECT_DEADLINE}ms. ${error}`);
		disconnect(error);
		return {ok: false, error};
	}

	console.log("[SOUND:connect]: Connected to Sound Board.")
	console.log(`[SOUND:connect]: Version ${client.state.get('global.mixer_version')}`);

	// Subscribe once the TCP session exists so the console actually receives the UM packet
	try {
		await client.meterSubscribe();
		console.log("[SOUND:connect]: Connected to Metering Data.");
	} catch (error) {
		console.warn("[SOUND:connect]: Failed to subscribe to metering data", error);
	}

	return {ok: true};
}




/**
 * Set a channel's color on the console
 * The API decodes the color with Buffer.from(hex, "hex"), which returns an empty
 * buffer if the string starts with "#", so strip it first.
 * @param {import("@featherbear/presonus-studiolive-api").ChannelSelector} selector
 * @param {String} color e.g. "#ffffff"
 */
const set_color = (selector, color) => {
	presonusClient.setColor(selector, color.replace(/^#/, ""));
}

/**
 * Set a channel's fader position (0-100)
 * Sent as an exact position: the API's dB call rounds down to a whole percent (up to 0.5 dB
 * low each time), which would add up as levels follow people from DCA to DCA.
 * The API call is async, so catch its errors here instead of leaving an unhandled rejection
 * @param {import("@featherbear/presonus-studiolive-api").ChannelSelector} selector 
 * @param {Number} position 0-100
 */
const set_fader = (selector, position) => {
	if (selector.type === 'DCA') dca_faders.set(selector.channel, position);

	presonusClient.setChannelVolumeLinear(selector, position).catch((error) => {
		console.log(`[SOUND]: Failed to set ${selector.type} #${selector.channel} level`, error);
	});
}

/**
 * Get the channels assigned to a DCA in a cue
 * Tolerates missing fields and numeric values (e.g. a cue with only labels)
 * @param {Cue} cue
 * @param {Number} dca DCA number (1-12)
 * @param {{raw?: boolean}} options raw: the show's channels, not their backups
 * @return {Number[]} channel numbers
 */
const get_dca_channels = (cue, dca, {raw = false} = {}) => {
	const value = cue?.[`dca${String(dca).padStart(2, "0")}Channels`];

	const channels = String(value ?? "")
		.split(",")
		.map(Number)
		.filter((ch) => Number.isInteger(ch) && ch > 0);
	// Channels switched to their backup are carried by the backup (raw: the show's own channels)
	return raw ? channels : channels.map(live_channel);
}

/**
 * Get Cue Channels
 * @return {Number[]} channels in cue
 */
const get_cue_channels = () => {
	if (current_cue === null) {
		return [];
	}

	let arr = [];

	// The same DCAs write_dcas writes (the console may have fewer than 8)
	for (const i of get_dca_list()) {
		arr.push(...get_dca_channels(current_cue, i));
	}

	return arr;
}


/**
 * Read a value from the state snapshot the console sent on (re)connect. Unlike
 * client.state, this ignores values cached from before the connection dropped.
 * @param {Object} snapshot client.dumpState().internal
 * @param {String} path e.g. "filtergroup/ch1/line3"
 */
const snapshot_get = (snapshot, path) => {
	let node = snapshot;
	for (const key of path.split("/")) {
		node = node?.children?.[key] ?? node?.[key];
		if (node === undefined) return undefined;
	}
	return node;
}

const is_on = (value) => value === true || (typeof value === 'number' && value >= 0.5);

/**
 * After a reconnect, compare what we last wrote with the console's fresh state. After a
 * network blip nothing differs and nothing is touched (live fader moves are kept). If the
 * console rebooted or was changed while we were away, forget those DCAs / line names and
 * re-apply the current cue so the console matches straight away instead of at the next Go.
 * @param {Client} client 
 */
const resync_after_reconnect = (client) => {
	let snapshot;
	try {
		snapshot = client.dumpState().internal;
	} catch (error) {
		debugLog('RECONNECT', "Couldn't read the console's state after reconnecting; rewriting everything", error.message);
		reset_console_state();
		snapshot = null;
	}

	const changed = [];

	if (snapshot) {
		for (const [dca, applied] of Object.entries(applied_dcas)) {
			if (!applied) continue;

			const channels = all_lines()
				.filter((n) => is_on(snapshot_get(snapshot, `filtergroup/ch${dca}/line${n}`)))
				.join(",");
			const name = snapshot_get(snapshot, `filtergroup/ch${dca}/name`) ?? "";

			if (channels !== applied.channels || name !== applied.label) {
				changed.push(`DCA ${dca} (console has "${name}" ch [${channels}], we sent "${applied.label}" ch [${applied.channels}])`);
				delete applied_dcas[dca];
			}
		}

		for (const [ch, name] of Object.entries(line_names)) {
			const actual = snapshot_get(snapshot, `line/ch${ch}/username`) ?? "";
			if (actual !== name) {
				changed.push(`line ${ch} name ("${actual}" instead of "${name}")`);
				// Record what the console really shows (not forget it: the client's cache can still
				// hold the old name, which would make the resend look unnecessary)
				line_names[ch] = actual;
			}
		}
	}

	if (snapshot && changed.length === 0) {
		debugLog('RECONNECT', "Reconnected; the console still matches, nothing to resend");
		return;
	}

	debugLog('RECONNECT', `Reconnected; the console changed while we were away: ${changed.join("; ") || "unknown state"}`);

	if (last_fired?.type === 'cue') {
		debugLog('RECONNECT', `Re-applying the current cue ${last_fired.cue.number}.${last_fired.cue.point}`);
		write_cue(null, {cue_object: last_fired.cue});
	} else if (last_fired?.type === 'linecheck') {
		debugLog('RECONNECT', "Re-applying Line Checks");
		fire_sound_check();
	}
}

/**
 * A fresh connection: fire the active cue so the console matches the app. That's the last
 * cue fired, or Line Checks if none has been (the editor starts on Line Checks).
 */
const apply_active_cue = () => {
	// No show yet (e.g. connected on launch before it opened): it's applied when it opens
	if (!getShow()) {
		debugLog('CONNECT', "Connected with no show open; the active cue fires when one is opened");
		return;
	}

	if (last_fired?.type === 'cue') {
		debugLog('CONNECT', `Connected: firing the active cue ${last_fired.cue.number}.${last_fired.cue.point}`);
		write_cue(null, {cue_object: last_fired.cue});
	} else {
		debugLog('CONNECT', "Connected: firing the active cue, Line Checks");
		fire_sound_check();
	}
}

/**
 * A show was opened: forget what was written to the console, and since the editor starts
 * on Line Checks, that's the active cue: put it on the console if we're connected
 */
const show_opened = () => {
	reset_console_state();
	current_cue = null;
	last_fired = null;
	// Backup switches belong to the show that was open
	switched = new Set();
	spare_for = null;
	consoleEvents.emit('backups', get_backup_status());

	if (presonusClient !== null && console_status.state === 'connected') apply_active_cue();
}

/**
 * Forget what has been written to the console so the next cue rewrites everything
 * (DCA assignments, levels, mutes, names, colors and line names).
 * Called on connect and show load.
 */
const reset_console_state = () => {
	cue_display = new Map();
	applied_dcas = {};
	applied_settings = new Map();
	line_names = {};
	channel_levels = new Map();
	dca_colors = new Map();
	cue_snapshots = new Map();
}

/**
 * A DCA's fader position on the console right now
 * @param {Number} dca
 * @returns {Number | null} 0-100, or null if unknown
 */
const read_dca_fader = (dca) => {
	// Moved or set since connecting, else the console's state from when we connected (0-100)
	const position = dca_faders.get(dca) ?? presonusClient?.getLevel({type: 'DCA', channel: dca});
	return typeof position === 'number' ? position : null;
}

/**
 * Whether a DCA is muted on the console right now
 * @param {Number} dca
 * @returns {Boolean | null} null if unknown
 */
const read_dca_mute = (dca) => {
	const muted = dca_mutes.get(dca) ?? presonusClient?.state.get(`filtergroup/ch${dca}/mute`);
	return typeof muted === 'boolean' ? muted : null;
}

/**
 * Mute or unmute a DCA, remembering it
 * @param {Number} dca
 * @param {Boolean} muted
 */
const set_dca_mute = (dca, muted) => {
	const selector = {type: 'DCA', channel: dca};
	sent_dca_mutes.set(dca, {muted, at: Date.now()});
	if (muted) presonusClient.mute(selector); else presonusClient.unmute(selector);
	dca_mutes.set(dca, muted);
}

/**
 * Backup pairs: main channel -> backup channel (the spare included while it's standing in)
 * @returns {Map<number, number>}
 */
const get_backups = () => {
	const backups = new Map();
	for (const [backup, main] of parse_map(getShow()?.config?.backupChannels)) backups.set(Number(main), Number(backup));
	const spare = get_spare();
	if (spare && spare_for !== null) backups.set(spare_for, spare);
	return backups;
}

/** The spare backup channel (Show Setup), or null */
const get_spare = () => {
	const spare = Number(getShow()?.config?.spareBackup);
	return Number.isInteger(spare) && spare > 0 ? spare : null;
}

/** The channel actually carrying a show channel right now (its backup if it's switched) */
const live_channel = (ch) => switched.has(ch) ? (get_backups().get(ch) ?? ch) : ch;

/** Every line the app manages: the show's channels, their backups and the spare */
const all_lines = () => [...new Set([
	...CONTROLLED_LINES, ...get_show_channels(), ...get_backups().values(), ...(get_spare() ? [get_spare()] : []),
])].sort((a, b) => a - b);

/**
 * Backup status for the cue list's tray
 * @returns {{pairs: {main: Number, backup: Number, label: String, switched: Boolean, spare: Boolean}[], spare: Number | null, spareFor: Number | null}}
 */
const get_backup_status = () => ({
	pairs: [...get_backups()].map(([main, backup]) => ({
		main, backup, label: get_profile_label(main) || `Ch ${main}`, switched: switched.has(main), spare: backup === get_spare() && spare_for === main,
	})).sort((a, b) => a.main - b.main),
	spare: get_spare(),
	spareFor: spare_for,
});

/** The tray and the console need updating after a switch */
const backups_changed = () => {
	consoleEvents.emit('backups', get_backup_status());
	if (presonusClient === null) return;
	if (last_fired?.type === 'linecheck') { set_soundcheck_labels(); write_line_mutes([], 'mute'); }
	else if (current_cue) write_cue(null, {cue_object: current_cue});
}

/**
 * Switch a show channel to its backup, or back (tray double-click, DCA mute button)
 * @param {Number} main
 */
const toggle_backup = (main) => {
	if (!get_backups().has(main)) return get_backup_status();
	const from = live_channel(main);
	if (switched.has(main)) switched.delete(main); else switched.add(main);
	copy_line_level(main, from, live_channel(main));
	debugLog('BACKUP', `Channel ${main} -> ${switched.has(main) ? `backup channel ${get_backups().get(main)}` : "back to its own channel"}`);
	backups_changed();
	return get_backup_status();
}

/**
 * Stand the spare backup in for a channel (switched to it straight away), or free it (null)
 * @param {Number | null} main
 */
const assign_spare = (main) => {
	// The channel the spare stood in for goes back to its own line, and the new one moves onto the spare
	const before = [spare_for, main].filter((ch) => ch !== null).map((ch) => [ch, live_channel(ch)]);
	if (spare_for !== null) switched.delete(spare_for);
	spare_for = main;
	if (main !== null) switched.add(main);
	for (const [ch, from] of before) copy_line_level(ch, from, live_channel(ch));
	debugLog('BACKUP', main === null ? "Spare backup freed" : `Spare backup channel ${get_spare()} standing in for channel ${main}`);
	backups_changed();
	return get_backup_status();
}

/**
 * A DCA's mute button pressed on the console: like TheatreMix, it switches the DCA's channels
 * that have a backup (unless the show turns that off), and the DCA is unmuted again
 * @param {Number} dca
 */
const dca_mute_pressed = (dca) => {
	if (getShow()?.config?.suppressDCAMuteBackupSwitch === "1" || !current_cue) return;
	const mains = get_dca_channels(current_cue, dca, {raw: true}).filter((ch) => get_backups().has(ch));
	if (!mains.length) return;
	debugLog('BACKUP', `DCA ${dca} mute pressed: switching ch ${mains.join(", ")}`);
	for (const ch of mains) if (switched.has(ch)) switched.delete(ch); else switched.add(ch);
	set_dca_mute(dca, false);
	backups_changed();
}

/**
 * The channels the show controls (TheatreMix Show Setup → Channels), else CONTROLLED_LINES
 * @returns {Number[]}
 */
const get_show_channels = () => {
	const from_show = String(getShow()?.config?.channels ?? "")
		.split(",")
		.map(Number)
		.filter((ch) => Number.isInteger(ch) && ch > 0);
	return from_show.length ? from_show : CONTROLLED_LINES;
}

/**
 * Whether a line is muted on the console right now
 * @param {Number} ch
 * @returns {Boolean | null} null if unknown
 */
const read_line_mute = (ch) => {
	const muted = line_mutes.get(ch) ?? presonusClient?.state.get(`line/ch${ch}/mute`);
	return typeof muted === 'boolean' ? muted : null;
}

/**
 * Mute the show's channels that aren't in any of the cue's DCAs, and unmute the ones that are,
 * so only lines on a DCA ever reach the output (TheatreMix: "consoleMuteDCAUnassign", on unless
 * the show turns it off). Lines are only sent a mute when it changes.
 *
 * Called in two passes around the DCA writes, so nobody is briefly live on the wrong DCA:
 * 'mute' before (channels leaving the DCAs go quiet first), 'unmute' after (channels joining
 * come up once they're on their DCA).
 * @param {Number[]} cue_channels channels in the cue's DCAs
 * @param {'mute' | 'unmute'} pass
 */
const write_line_mutes = (cue_channels, pass) => {
	if (getShow()?.config?.consoleMuteDCAUnassign === "0") return;

	const assigned = new Set(cue_channels);
	const changed = [];
	// The show's channels and their backups (a switched channel's backup carries it)
	for (const ch of new Set([...get_show_channels(), ...get_backups().values()])) {
		const muted = !assigned.has(ch);
		if (muted !== (pass === 'mute') || read_line_mute(ch) === muted) continue;

		const selector = {type: 'LINE', channel: ch};
		if (muted) presonusClient.mute(selector); else presonusClient.unmute(selector);
		line_mutes.set(ch, muted);
		changed.push(ch);
	}

	if (changed.length) {
		debugLog('MUTES', `${pass === 'mute' ? "Muted (not on a DCA)" : "Unmuted (on a DCA)"}: ch ${changed.join(", ")}`);
	}
}

/**
 * A line parameter's value on the console right now
 * @param {Number} ch
 * @param {String} param e.g. "eq/eqgain1"
 * @returns {Number | null}
 */
const read_param = (ch, param) => {
	const key = `line/ch${ch}/${param}`;
	let value = param_values.get(key) ?? presonusClient?.state.get(key);
	if (Buffer.isBuffer(value) && value.length >= 4) value = value.readFloatLE(0);
	else if (value && typeof value === 'object' && 'value' in value) value = value.value;
	if (typeof value === 'boolean') value = value ? 1 : 0;
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Send a line parameter (the library has no general setter, so the PV message directly)
 * @param {Number} ch
 * @param {String} param
 * @param {Number} value 0-1
 */
const send_param = (ch, param, value) => {
	const key = `line/ch${ch}/${param}`;
	const float = Buffer.alloc(4);
	float.writeFloatLE(Number(value));
	presonusClient._sendPacket('PV', Buffer.concat([Buffer.from(`${key}\0\0\0`), float]));
	param_values.set(key, Number(value));
}

/**
 * Show Setup / Actor Setup → Store from console: a line's current settings
 * @param {Number} ch
 * @param {String[]} sections e.g. ['gain', 'eq']
 * @returns {{ok: true, settings: Object<string, Object>} | {ok: false, error: String}}
 */
const capture_channel_settings = (ch, sections, {log = true} = {}) => {
	if (presonusClient === null || console_status.state !== 'connected') return {ok: false, error: "Connect to the console first"};
	const live = live_channel(ch);
	const settings = {};
	for (const section of sections.filter((x) => SETTING_PARAMS[x])) {
		const values = Object.fromEntries(SETTING_PARAMS[section].map((p) => [p, read_param(live, p)]).filter(([, v]) => v !== null));
		if (Object.keys(values).length) settings[section] = values;
	}
	if (log) debugLog('SETTINGS', `Stored channel ${live}'s ${Object.keys(settings).join(", ") || "nothing"} from the console`);
	return {ok: true, settings};
}

/**
 * A line's gain / HPF / EQ / dynamics on the console now, without storing anything (Show Setup
 * shows them for a character with nothing stored yet)
 * @param {Number} ch
 */
const read_channel_settings = (ch) => capture_channel_settings(ch, Object.keys(SETTING_PARAMS), {log: false});

/**
 * The stored settings a channel should have with a profile (TheatreMix): each section the
 * profile stores comes from the active actor (if the profile stores it per actor) or the
 * profile; sections it doesn't store come from the channel's default profile the same way
 * @param {Number} ch
 * @param {Object} profile
 * @returns {Object<string, Object>} section -> {param: value}
 */
const settings_for = (ch, profile) => {
	const show = getShow();
	const rows = show?.channelSettings ?? [];
	const stored = (owner, section) => {
		const row = rows.find((r) => r.owner === owner && r.section === section);
		try { return row ? JSON.parse(row.data) : null; } catch { return null; }
	};
	const actor = get_actor(ch);
	const from = (p, section) => {
		if (!p) return null;
		const flags = profile_flags(p);
		return (actor && flags.actor.has(section) ? stored(`actor:${actor.id}:${p.id}`, section) : null)
			?? (flags.store.has(section) ? stored(`profile:${p.id}`, section) : null);
	};
	const fallback = default_profile(show, ch);
	const out = {};
	for (const section of SETTING_SECTIONS) {
		const data = from(profile, section) ?? (profile !== fallback ? from(fallback, section) : null);
		if (data) out[section] = data;
	}
	return out;
}

/**
 * The character (profile) a line plays for a cue: the one it plays in the cue if it's assigned
 * there, otherwise the one it plays in the next cue that uses it (so the line already shows who
 * is coming on), otherwise its default profile
 * @param {Number} ch
 * @param {Cue | null} cue (null: Line Checks)
 * @returns {Object | null} profile
 */
const character_for = (ch, cue) => {
	const show = getShow();
	if (!show) return null;
	const assigned = (c) => Array.from({length: MAX_SHOW_DCAS}, (_, i) => get_dca_channels(c, i + 1, {raw: true})).some((list) => list.includes(ch));
	const sorted = [...show.cues].sort((a, b) => (Number(a.number) - Number(b.number)) || (Number(a.point) - Number(b.point)));
	const start = cue ? sorted.findIndex((c) => Number(c.number) === Number(cue.number) && Number(c.point) === Number(cue.point)) : 0;
	const from = cue && start === -1 ? [cue] : sorted.slice(Math.max(0, start)).filter((c) => c === cue || !Number(c.skip));
	const playing = (cue && assigned(cue)) ? cue : from.find((c) => assigned(c));
	const id = playing ? parse_map(playing.channelProfiles).get(ch) : undefined;
	return (id !== undefined && show.profiles.find((p) => String(p.id) === id)) || default_profile(show, ch);
}

/**
 * Put each show channel's stored settings on the console for this cue's profiles (and actors),
 * sending only sections that changed since they were last sent
 * @param {Cue | null} cue (null: Line Checks, default profiles)
 */
const apply_channel_settings = (cue) => {
	const show = getShow();
	if (!show?.channelSettings?.length) return;
	const sent = [];
	for (const ch of get_show_channels()) {
		// The character it plays now, or next (so their settings are ready before they're on)
		const profile = character_for(ch, cue);
		const live = live_channel(ch);
		const previous = applied_settings.get(live) ?? {};
		for (const [section, values] of Object.entries(settings_for(ch, profile))) {
			const key = JSON.stringify(values);
			if (previous[section] === key) continue;
			for (const [param, value] of Object.entries(values)) send_param(live, param, value);
			previous[section] = key;
			sent.push(`ch ${live} ${section}`);
		}
		applied_settings.set(live, previous);
	}
	if (sent.length) debugLog('SETTINGS', `Stored settings for ${cue ? `cue ${cue.number}.${cue.point}` : "Line Checks"}: ${sent.join(", ")}`);
}

/**
 * A show channel's level offset in a cue (dB), 0 unless Show Setup → "Store level offsets" is on
 * @param {Cue | null} cue
 * @param {Number} ch
 */
const line_offset = (cue, ch) => {
	if (!cue || getShow()?.config?.channelLevels !== "1") return 0;
	return (Number(parse_map(cue.channelLevels).get(ch)) || 0) / 10;   // stored in tenths of a dB
}

/**
 * A line's fader level on the console now (dB), or null if unknown
 * @param {Number} line
 */
const read_line_level = (line) => {
	const position = line_faders.get(line) ?? presonusClient?.getLevel({type: 'LINE', channel: line});
	return typeof position === 'number' ? fader_to_level_exact(position) : null;
}

/**
 * Set a line's fader (dB)
 * @param {Number} line
 * @param {Number} db
 */
const set_line_level = (line, db) => {
	const position = level_to_fader(Math.min(10, db));
	line_faders.set(line, position);
	presonusClient.setChannelVolumeLinear({type: 'LINE', channel: line}, position).catch((error) => {
		debugLog('LEVELS', `Couldn't set channel ${line}'s fader`, error.message);
	});
}

/**
 * Put each line that's just come onto a DCA at 0 dB plus its level offset. Lines already on a
 * DCA (this one or another) keep any trim the operator has given them; if their offset changes,
 * the fader moves by the difference.
 * @param {Cue | null} cue (null: Line Checks, nobody's on a DCA)
 */
const apply_line_levels = (cue) => {
	const placed = new Set();
	if (cue) for (const dca of get_dca_list()) {
		for (const ch of get_dca_channels(cue, dca, {raw: true})) placed.add(ch);
	}

	const moved = [];
	for (const ch of placed) {
		const offset = line_offset(cue, ch);
		const live = live_channel(ch);
		const before = line_placed.get(ch);
		line_placed.set(ch, {live, offset});
		if (before?.live === live) {
			// Still on a DCA: keep the trim, shifted by any change in offset
			const delta = offset - before.offset;
			const level = read_line_level(live);
			if (Math.abs(delta) < 0.05 || level === null) continue;
			set_line_level(live, level + delta);
			moved.push(`ch ${live} ${delta > 0 ? "+" : ""}${Number(delta.toFixed(1))} dB (offset)`);
		} else {
			set_line_level(live, offset);
			moved.push(`ch ${live} ${format_offset(offset)}`);
		}
	}
	// Off a DCA: it's muted, and set again when it next joins one
	for (const ch of [...line_placed.keys()]) if (!placed.has(ch)) line_placed.delete(ch);

	if (moved.length) debugLog('LEVELS', `Line faders for cue ${cue.number}.${cue.point}: ${moved.join(", ")}`);
}

/** "0 dB", "+2.5 dB", "-3 dB" */
const format_offset = (db) => db === 0 ? "0 dB" : `${db > 0 ? "+" : ""}${Number(db.toFixed(1))} dB`;

/**
 * Each show channel's fader on the console now, against where it was put (the DCA editor
 * shows lines that have been moved)
 * @returns {{connected: boolean, cue: String | null, lines: Object<number, {line: Number, db: Number | null, target: Number | null}>}}
 */
const get_line_levels = () => {
	const connected = presonusClient !== null && console_status.state === 'connected';
	const lines = {};
	if (connected) for (const ch of get_show_channels()) {
		const live = live_channel(ch);
		lines[ch] = {line: live, db: read_line_level(live), target: line_placed.get(ch)?.offset ?? null};
	}
	return {connected, cue: current_cue ? cue_key(current_cue) : null, lines};
}

/**
 * Switching a channel to or from its backup: the new channel takes over the old one's fader
 * level, if it's a sensible one (between -30 and +6 dB), else 0 dB plus the offset
 * @param {Number} main
 * @param {Number} from the line carrying it before
 * @param {Number} to the line carrying it now
 */
const copy_line_level = (main, from, to) => {
	if (presonusClient === null || from === to || !line_placed.has(main)) return;
	const level = read_line_level(from);
	const offset = line_offset(current_cue, main);
	const sensible = level !== null && level >= COPY_LEVEL_MIN_DB && level <= COPY_LEVEL_MAX_DB;
	const db = sensible ? level : offset;
	set_line_level(to, db);
	line_placed.set(main, {...line_placed.get(main), live: to});
	debugLog('BACKUP', `Channel ${to} takes over channel ${from}'s fader: ${format_offset(Math.round(db * 10) / 10)}${sensible ? "" : ` (channel ${from} was at ${level === null ? "an unknown level" : format_offset(Math.round(level * 10) / 10)})`}`);
}

/**
 * Key for a cue in cue_snapshots
 * @param {Cue} cue
 */
const cue_key = (cue) => `${Number(cue.number)}.${Number(cue.point)}`;

/**
 * Leaving the current cue: remember each DCA's fader and mute, for going Back into it
 */
const save_cue_snapshot = () => {
	if (current_cue === null) return;

	const snapshot = new Map();
	for (const [dca, applied] of Object.entries(applied_dcas)) {
		if (!applied?.channels) continue;
		snapshot.set(Number(dca), {channels: applied.channels, fader: read_dca_fader(Number(dca)), muted: read_dca_mute(Number(dca))});
	}
	cue_snapshots.set(cue_key(current_cue), snapshot);
}

/**
 * Before a cue changes anything: remember the level every assigned person is at now
 * (their DCA's live fader), so it can follow them to another DCA
 */
const remember_channel_levels = () => {
	for (const [dca, applied] of Object.entries(applied_dcas)) {
		if (!applied?.channels) continue;

		const position = read_dca_fader(Number(dca));
		if (position === null) continue;

		for (const ch of applied.channels.split(",").map(Number)) channel_levels.set(ch, position);
	}
}

/**
 * The fader position a DCA's new channels were last mixed at. If they come from different
 * DCAs, the position most of them share wins (ties go to the first channel listed).
 * @param {Number[]} channels
 * @returns {Number | null} 0-100, or null if none of them have a level yet
 */
const carried_level = (channels) => {
	const counts = new Map();
	for (const ch of channels) {
		const level = channel_levels.get(ch);
		if (level !== undefined) counts.set(level, (counts.get(level) ?? 0) + 1);
	}

	let best = null;
	for (const [level, count] of counts) {
		if (best === null || count > counts.get(best)) best = level;
	}
	return best;
}

/**
 * Write a single DCA for a cue
 *
 * Fader level:
 *  - a level set for this cue's DCA (DCA level popup) is always applied when the cue fires
 *  - otherwise, when the DCA gets different channels, it takes the level those people were
 *    last mixed at (the fader of the DCA they came from), so their offset follows them
 *  - otherwise, when the DCA comes up for the first time (it was empty, or none of its people
 *    have been mixed yet), it goes to NEW_DCA_LEVEL (-20 dB)
 *  - otherwise (same channels) the fader is left where it is
 * Mute is only sent when the channel assignment changes, so a DCA that keeps its channels
 * isn't touched and live fader moves are kept. An unassigned DCA is muted and pulled to -∞
 * (and shows black, see update_dca_colors), so it's obvious it's empty.
 *
 * Going Back into a cue (restore given): a DCA with the same channels as when that cue was
 * last left gets its fader and mute back exactly as they were.
 * @param {Cue} cue_object 
 * @param {Number} dca DCA number
 * @param {{channels: String, fader: Number | null, muted: Boolean | null} | undefined} restore
 */
const write_dca = (cue_object, dca, restore) => {
	const selector = {type: 'DCA', channel: dca};
	const channels = get_dca_channels(cue_object, dca);
	const channels_key = [...channels].sort((a, b) => a - b).join(",");
	const label = cue_object[`dca${String(dca).padStart(2, "0")}Label`] ?? "";
	const previous = applied_dcas[dca];

	const reassigned = previous?.channels !== channels_key;
	const configured = channels.length ? get_dca_level(getShow()?.dcaLevels, cue_object, dca) : null;

	if (channels.length && restore?.channels === channels_key) {
		debugLog('LEVELS', `Back to cue ${cue_object.number}.${cue_object.point} DCA ${dca} -> ch ${channels_key} restored` +
			`${restore.fader !== null ? ` at ${format_dca_level(fader_to_level(restore.fader))}` : ""}` +
			`${restore.muted !== null ? `, ${restore.muted ? "muted" : "unmuted"}` : ""}`);

		if (restore.fader !== null) {
			set_fader(selector, restore.fader);
			for (const ch of channels) channel_levels.set(ch, restore.fader);
		}
		if (reassigned) presonusClient.assign_dca(selector, channels, all_lines());

		const muted = restore.muted ?? false;
		if (reassigned || read_dca_mute(dca) !== muted) set_dca_mute(dca, muted);
	} else if (reassigned && channels.length === 0) {
		// Being cleared: muted and pulled to -∞ so it's obvious it's unassigned (the level
		// its people were at was remembered first, so it follows them)
		debugLog('LEVELS', `Cue ${cue_object.number ?? "Line Checks"}${cue_object.point !== undefined ? `.${cue_object.point}` : ""} DCA ${dca} unassigned -> -∞, muted`);
		set_dca_mute(dca, true);
		set_fader(selector, 0);
		presonusClient.assign_dca(selector, channels, all_lines());
	} else if (reassigned || configured !== null) {
		// Set the level before the new channels land on it
		// Console Setup → DCA Recall: "Levels follow people"
		const carried = reassigned && getSettings().levelsFollowPeople ? carried_level(channels) : null;
		const first_time = reassigned && carried === null &&
			(!previous?.channels || channels.every((ch) => !channel_levels.has(ch)));
		const position = configured !== null ? level_to_fader(configured)
			: carried !== null ? carried
			: first_time ? level_to_fader(NEW_DCA_LEVEL)
			: null;
		const source = configured !== null ? "set for this cue"
			: carried !== null ? "where these channels were last mixed"
			: first_time ? "first time up, default level"
			: !getSettings().levelsFollowPeople ? "levels don't follow people (Console Setup), fader left as is"
			: "no level set, fader left as is";

		const shown = configured ?? (position !== null ? fader_to_level(position) : null);
		debugLog('LEVELS', `Cue ${cue_object.number}.${cue_object.point} DCA ${dca} -> ch ${channels_key}` +
			`${shown !== null ? ` at ${format_dca_level(shown)}` : ""} (${source})`);

		if (position !== null) {
			set_fader(selector, position);
			for (const ch of channels) channel_levels.set(ch, position);
		}

		if (reassigned) {
			presonusClient.assign_dca(selector, channels, all_lines());
			set_dca_mute(dca, false);
		}
	}

	if (previous?.label !== label) {
		presonusClient.setName(selector, label);
	}

	applied_dcas[dca] = {channels: channels_key, label};
}

/**
 * Write Cue - NEW
 * @param {Event} _event 
 * @param {Cue} cue_object 
 * @async
 */
const write_cue = async (_event, {cue_object, back = false}) => {

	/*
	cue_object = {
		number: 0,
		point: 60,
		name: 'Preshow Speech',
		dca01Channels: '16',
		dca02Channels: '9',
		dca03Channels: '',
		dca04Channels: '',
		dca05Channels: '',
		dca06Channels: '',
		dca07Channels: '',
		dca08Channels: '',
		dca01Label: 'Stage 1',
		dca02Label: 'Pumbaa',
		dca03Label: '-',
		dca04Label: '-',
		dca05Label: '-',
		dca06Label: '-',
		dca07Label: '-',
		dca08Label: '-',
		channelPositions: '',
		channelProfiles: '',
		fxMutes: '',
		channelFX: '',
		snippets: '',
		qLabCue: '0.6',
		channelLevels: '',
		scenes: '',
		colour: 1,
		scenePoints: '',
		dca09Channels: '',
		dca09Label: '-',
		dca10Channels: '',
		dca10Label: '-',
		dca11Channels: '',
		dca11Label: '-',
		dca12Channels: '',
		dca12Label: '-',
		skip: 0
	}
	*/
	
	if (presonusClient !== null) save_cue_snapshot();

	current_cue = cue_object;
	last_fired = {type: 'cue', cue: cue_object};
	
	console.log("[SOUND:write_cue]: Writing Cue")

	if (presonusClient === null) {
		console.warn("Client is not yet connected!")
		return;
	}

	init_channels();
	// Back into a cue we've been in: put its DCAs back as they were when we left it
	// (Console Setup → DCA Recall: "Back restores DCAs")
	const restore_on_back = back && getSettings().restoreOnBack;
	const restore = restore_on_back ? cue_snapshots.get(cue_key(cue_object)) : undefined;
	if (restore_on_back) debugLog('LEVELS', `Back to cue ${cue_key(cue_object)}: ${restore ? "restoring its DCAs" : "never left before, nothing to restore"}`);

	// Only lines on one of this cue's DCAs come through: mute the rest before the DCAs change,
	// unmute the new ones after they're on their DCA
	const cue_channels = get_cue_channels();
	write_line_mutes(cue_channels, 'mute');
	write_dcas(cue_object, restore);
	write_line_mutes(cue_channels, 'unmute');
	apply_line_levels(cue_object);
	apply_channel_settings(cue_object);
	update_dca_colors();

	// Channels in this cue's DCAs show yellow while they have signal
	setActiveChannels(cue_channels);

	// TODO: Write AUX assignments?
	// filtergroup/ch1/mute_aux* - 0 or 1
	// filtergroup/ch1/aux* - volume 0.0 - 1.0
	
	
}

/**
 * The DCAs to write: the show's (Show Setup → DCAs to control, up to 24 with "Use all 24 DCAs"),
 * that the console has
 * @returns {Number[]}
 */
const get_dca_list = () => {
	const console_dcas = presonusClient?.channelCounts?.DCA;
	return show_dcas(getShow()).filter((d) => !(console_dcas > 0) || d <= console_dcas);
}

/**
 * The cue after the current one (skipping cues marked skip), in show order. After Line
 * Checks (no current cue) it's the first cue.
 * @returns {Cue | null}
 */
const get_next_cue = () => next_cue(getShow()?.cues ?? [], current_cue);

/**
 * Darken a color (for dimmed DCAs)
 * @param {String} hex "rrggbb"
 */
const dim_color = (hex) => hex.match(/../g)
	.map((c) => Math.round(parseInt(c, 16) * DIM_FACTOR).toString(16).padStart(2, "0"))
	.join("");

/**
 * What a DCA's color should be now: what happens to it in the next cue (TheatreMix's
 * DCA color coding), dimmed when its fader is at -∞ if the show asks for that
 * @param {Number} dca
 * @param {Cue | null} next
 * @returns {{color: String, reason: String}}
 */
const dca_color_for = (dca, next) => {
	// Unassigned now: always black, so it's obvious (whatever the next cue does with it)
	const raw = dca_next_state(current_cue, next, dca);
	// View → Color-Blind DCA Colors
	const state = getSettings().colorBlindDca ? color_blind_state(raw) : raw;

	let color = DCA_COLORS[state];

	// Dim DCA Faders (TheatreMix show setting): a DCA at -∞ dims its scribble strip
	const config = getShow()?.config ?? {};
	const fader = read_dca_fader(dca);
	if (state !== 'off' && config.dimDCAFaders === "1" && fader !== null && fader <= DIM_FADER) {
		color = config.dimDCAFadersSuppressColours === "1" ? DCA_COLORS.dimmed : dim_color(color);
		return {color, reason: `${state}, dimmed (fader at -∞)`};
	}

	return {color, reason: state};
}

/**
 * Set one DCA's color if it changed
 * @param {Number} dca
 * @param {Cue | null} next
 */
const update_dca_color = (dca, next = get_next_cue()) => {
	if (presonusClient === null || !get_dca_list().includes(dca)) return;
	if (current_cue === null && last_fired?.type !== 'linecheck') return;   // nothing fired yet

	const {color, reason} = dca_color_for(dca, next);
	if (dca_colors.get(dca) === color) return;

	debugLog('DCACOLOR', `DCA ${dca} -> ${color} (${reason}; next cue ${next ? `${next.number}.${next.point}` : "none"})`);
	try {
		set_color({type: 'DCA', channel: dca}, color);
		dca_colors.set(dca, color);
	} catch (error) {
		debugLog('DCACOLOR', `Couldn't color DCA ${dca}`, error.message);
	}
}

/**
 * Color every DCA for what's coming in the next cue
 */
const update_dca_colors = () => {
	const next = get_next_cue();
	for (const dca of get_dca_list()) update_dca_color(dca, next);
	update_cue_display(next);
}

/**
 * The current and next cue on the console itself (Console Setup → Cue Display):
 *   - the Scenes screen's "Current Project" / "Current Scene" fields
 *   - optionally the main fader's scribble strip (its name), with the current or next cue
 * Scribble strips only fit about 10 characters, so they get just the cue number.
 *   - the two DCAs after the show's last one (DCAs 9 and 10 for a show on 1-8), named
 *     ">1.1" (now) and "^1.2" (next), so they sit beside the show's DCAs on the DCA layer.
 *     Only their names and colors are written: their faders, mutes and channels aren't touched.
 * What was last written: key -> value
 * @type {Map<string, string>}
 */
let cue_display = new Map();

// Cue display DCA scribble strip color
const CUE_DISPLAY_COLOR = "ffffff";

/** "1.5 Rafikis start singing" */
const cue_text = (cue) => cue ? `${format_cue_number(Number(cue.number), Number(cue.point))} ${cue.name ?? ""}`.trim() : "";

/** Scribble strip labels: ">1.1" for the current cue (">LC" in Line Checks), "^1.2" for the next ("^End" after the last) */
const strip_now = (cue) => cue ? `>${format_cue_number(Number(cue.number), Number(cue.point))}` : ">LC";
const strip_next = (cue) => cue ? `^${format_cue_number(Number(cue.number), Number(cue.point))}` : "^End";

/** The spare DCAs that show the current and next cue: [now, next], within the console's DCAs */
const cue_display_dcas = () => {
	const count = presonusClient?.channelCounts?.DCA ?? 0;
	const first = Math.max(0, ...show_dcas(getShow())) + 1;
	return [first, first + 1].filter((d) => d <= count);
}

/**
 * Write a cue display value if it changed
 * @param {String} key
 * @param {String} value
 * @param {Function} send
 */
const display_write = (key, value, send) => {
	if (cue_display.get(key) === value) return;
	try {
		send();
		cue_display.set(key, value);
	} catch (error) {
		debugLog('CUEDISPLAY', `Couldn't write ${key}`, error.message);
	}
}

/**
 * Put the current and next cue on the console (and take them off when turned off)
 * @param {Cue | null} next
 */
const update_cue_display = (next = get_next_cue()) => {
	if (presonusClient === null || console_status.state !== 'connected') return;
	if (current_cue === null && last_fired?.type !== 'linecheck') return;   // nothing fired yet

	const {cueOnScenesScreen, cueOnSpareDcas, cueOnMain} = getSettings();
	const now = current_cue ? cue_text(current_cue) : "Line Checks";
	const coming = next ? cue_text(next) : "End of show";
	const written = [];

	const send_string = (key, value) => display_write(key, value, () => {
		presonusClient._sendPacket('PS', Buffer.from(`${key}\0\0\0${value}\0`));
		written.push(`${key} = "${value}"`);
	});
	for (const field of ['project', 'scene']) {
		const value = !cueOnScenesScreen ? "" : field === 'project' ? `NOW ${now}` : `NEXT ${coming}`;
		// Never written and turned off: leave the console's own names alone
		if (!cueOnScenesScreen && !cue_display.has(`presets/loaded_${field}_title`)) continue;
		send_string(`presets/loaded_${field}_title`, value);
		send_string(`presets/loaded_${field}_name`, value);
	}

	// The main fader's scribble strip: the current or next cue, else back to "Main" if it showed one
	if (cueOnMain !== 'off' || cue_display.has('main')) {
		const label = cueOnMain === 'current' ? strip_now(current_cue) : cueOnMain === 'next' ? strip_next(next) : "Main";
		display_write('main', label, () => {
			presonusClient._sendPacket('PS', Buffer.from(`main/ch1/username\0\0\0${label}\0`));
			written.push(`Main = "${label}"`);
		});
		if (cueOnMain === 'off') cue_display.delete('main');
	}

	const dcas = cueOnSpareDcas ? cue_display_dcas() : [];
	// DCAs that showed cues but don't any more (turned off, or the show's DCAs changed): back to normal
	for (const key of [...cue_display.keys()].filter((k) => k.startsWith('dca:'))) {
		const dca = Number(key.split(':')[1]);
		if (dcas.includes(dca)) continue;
		presonusClient.setName({type: 'DCA', channel: dca}, `DCA ${dca}`);
		set_color({type: 'DCA', channel: dca}, DCA_COLORS.off);
		cue_display.delete(key);
		written.push(`DCA ${dca} back to "DCA ${dca}"`);
	}
	dcas.forEach((dca, i) => {
		const name = i === 0 ? strip_now(current_cue) : strip_next(next);
		display_write(`dca:${dca}`, name, () => {
			presonusClient.setName({type: 'DCA', channel: dca}, name);
			set_color({type: 'DCA', channel: dca}, CUE_DISPLAY_COLOR);
			written.push(`DCA ${dca} = "${name}"`);
		});
	});

	if (written.length) debugLog('CUEDISPLAY', written.join(", "));
}

/**
 * Write every DCA for a cue
 * @param {Cue} cue_object (an empty object clears them all)
 * @param {Map<number, Object>} [restore] going Back: the cue's DCAs as they were when it was left
 */
const write_dcas = (cue_object, restore) => {
	// Capture where everyone is mixed right now, before any DCA changes
	remember_channel_levels();

	for (const i of get_dca_list()) {
		try {
			write_dca(cue_object, i, restore?.get(i));
		} catch (error) {
			console.log(`[SOUND:write_cue]: Failed to write DCA #${i}`, error);
			// Unknown state, so fully rewrite this DCA on the next cue
			applied_dcas[i] = undefined;
		}
	}
}

/**
 * Fire Sound Check Cue: every line shows its actor's real name and every DCA is
 * cleared (unassigned, muted and blank), so nothing is up while mics are checked.
 * The levels people were mixed at are remembered for when they're next assigned.
 * @param {Event} _event 
 */
const fire_sound_check = async (_event) => {
	if (presonusClient !== null) save_cue_snapshot();
	current_cue = null;
	last_fired = {type: 'linecheck'};

	if (presonusClient === null) {
		console.warn("Console is not yet connected!");
		return;
	}

	debugLog('LINECHECK', "Line Checks: actors' names on the lines, clearing every DCA");
	set_soundcheck_labels();
	// No DCAs, so every show channel is muted
	write_line_mutes([], 'mute');
	write_dcas({});
	apply_line_levels(null);
	apply_channel_settings(null);
	// Show Setup → Levels: "Force all faders to 0 dB in the Line Checks cue"
	if (getShow()?.config?.cueZeroResetLevels === "1") {
		const unity = level_to_fader(0);
		debugLog('LINECHECK', `Line faders of the show's channels to 0 dB: ch ${get_show_channels().join(", ")}`);
		for (const ch of get_show_channels()) {
			line_faders.set(ch, unity);
			presonusClient.setChannelVolumeLinear({type: 'LINE', channel: ch}, unity).catch((error) => {
				debugLog('LINECHECK', `Couldn't set channel ${ch}'s fader`, error.message);
			});
		}
	}
	update_dca_colors();
	setActiveChannels([]);
}

/**
 * Get Profile in Show by channel number
 * @param {Number} ch channel number
 * @returns {Profile} TheatreMix Profile
 */
const get_profile = (ch) => {
	const show = getShow();
	if (!show) return null;

	for (let profile of show.profiles) {
		if (profile.channel === ch && profile.default) {
			return profile;
		}
	}
	return null;
}

/**
 * Label for a line from its default profile (what normal cues show)
 * @param {Number} ch channel number
 * @returns {String}
 */
const get_profile_label = (ch) => {
	const profile = get_profile(ch);

	if (profile === null) return "";

	return profile.label ?? profile.name ?? "";
}

/**
 * Get the actor on a channel: the first active actor assigned to it
 * (lowest order, then lowest id)
 * @param {Number} ch channel number
 * @returns {Actor} TheatreMix Actor
 */
const get_actor = (ch) => {
	const show = getShow();
	if (!show) return null;

	const actors = show.actors
		.filter((actor) => actor.channel === ch && actor.active)
		.sort((a, b) => (a.order - b.order) || (a.id - b.id));

	return actors[0] ?? null;
}

/**
 * Set a line's username, skipping the send if it already shows that name
 * @param {Number} ch channel number
 * @param {String} name 
 */
const set_line_name = (ch, name) => {
	const current = line_names[ch] ?? presonusClient.state.get(`line/ch${ch}/username`);

	if (current === name) {
		// Already showing it: remember that, so a reconnect can check it's still true
		line_names[ch] = name;
		return;
	}

	presonusClient.setName({type: 'LINE', channel: ch}, name);
	line_names[ch] = name;
}

/**
 * Backup channels show their main channel's name with a ~ (TheatreMix)
 * @param {Function} name_of main channel -> its name
 */
const name_backups = (name_of) => {
	for (const [main, backup] of get_backups()) set_line_name(backup, `~${name_of(main)}`);
}

/**
 * Initialize Channel Labels - each line shows its default profile's label
 */
const init_channels = async () => {
	try {
		// Each line shows the character it plays in this cue, or the one it plays next
		const label = (ch) => {
			const profile = character_for(ch, current_cue);
			return profile ? (profile.label || profile.name || "") : get_profile_label(ch);
		};
		// The show's controlled lines (Show Setup), any of the 32
		for (let ch_num of get_show_channels()) {
			set_line_name(ch_num, label(ch_num));
		}
		name_backups(label);
	} catch (error) {
		console.log("[Sound.js] Error: ", error);
	}
}

/**
 * Line Check labels - each line shows the name of the actor on it.
 * Lines without an actor (or when the show turns off "cueZeroActorLabels")
 * fall back to the profile label.
 */
const set_soundcheck_labels = async () => {
	if (presonusClient == null) {
		console.warn("Console is not yet connected!");
		return;
	}

	const use_actor_names = getShow()?.config?.cueZeroActorLabels !== "0";

	try {
		for (let ch of get_show_channels()) {
			const actor = use_actor_names ? get_actor(ch) : null;

			set_line_name(ch, actor?.name ?? get_profile_label(ch));
		}
		name_backups((ch) => (use_actor_names ? get_actor(ch)?.name : null) ?? get_profile_label(ch));
	} catch (error) {
		console.log("[SOUND:fire_sound_check]: Failed to set line check labels", error);
	}
}

/**
 * Monitor the open show's channels and refresh the DCA colors (call when the show changes)
 */
const sync_channel_monitor = () => {
	setMonitoredChannels(getShow(), CONTROLLED_LINES);
	// The show changed (edited, merged, settings): the next cue's DCA colors may have too
	update_dca_colors();
}

/**
 * Help → Read User Layer from Console: ask the console for its User Layer the way Universal
 * Control does ("Copy From Mixer" sends a JSON UserLayerSendRequest) and save everything the
 * console sends back over the next few seconds, so the reply's format can be worked out.
 * (The User Layer isn't in the console's shared state, so this is the only way to see it.)
 * @returns {Promise<{ok: true, file: String, summary: String} | {ok: false, error: String}>}
 */
const probe_user_layer = async () => {
	if (presonusClient === null || console_status.state !== 'connected') return {ok: false, error: "Connect to the console first"};
	const socket = presonusClient.conn;
	let raw = Buffer.alloc(0);
	const tap = (bytes) => { raw = Buffer.concat([raw, bytes]); };
	socket.on('data', tap);

	// JSON packets: length (16-bit LE), two zero bytes, then the JSON
	const json = Buffer.from(JSON.stringify({id: 'UserLayerSendRequest'}));
	const length = Buffer.alloc(2);
	length.writeUInt16LE(json.length);
	debugLog('USERLAYER', "Asking the console for its User Layer (UserLayerSendRequest)");
	presonusClient._sendPacket('JM', Buffer.concat([length, Buffer.from([0, 0]), json]));
	await new Promise((resolve) => setTimeout(resolve, USER_LAYER_PROBE_MS));
	socket.off('data', tap);

	// Split the stream into packets: "UC\0\1", payload length (16-bit LE), code, 4 bytes, data
	const packets = [];
	for (let i = 0; i + 8 <= raw.length;) {
		if (raw[i] !== 0x55 || raw[i + 1] !== 0x43 || raw[i + 2] !== 0 || raw[i + 3] !== 1) { i++; continue; }
		const size = raw.readUInt16LE(i + 4);
		const code = raw.subarray(i + 6, i + 8).toString('latin1');
		packets.push({code, data: raw.subarray(i + 12, i + 6 + size)});
		i += 6 + size;
	}

	const printable = (buf) => buf.toString('latin1').replace(/[^\x20-\x7e\n]/g, '.');
	const lines = [`User Layer probe, ${new Date().toISOString()}, console ${console_status.host}`, `${raw.length} bytes, ${packets.length} packets`, ""];
	for (const {code, data} of packets) {
		lines.push(`--- ${code} (${data.length} bytes)`);
		lines.push(printable(data));
		if (code === 'ZB' || code === 'CK') {
			for (const offset of [0, 4, 8]) {
				try { lines.push(`[inflated from byte ${offset}]`, printable(zlib.inflateSync(data.subarray(offset)))); break; } catch { /* not zlib here */ }
			}
		}
		lines.push(`[base64] ${data.toString('base64')}`, "");
	}

	const file = path.join(app.getPath('logs'), `userlayer-probe-${Date.now()}.txt`);
	fs.mkdirSync(path.dirname(file), {recursive: true});
	fs.writeFileSync(file, lines.join("\n"));
	const counts = Object.entries(packets.reduce((c, p) => ({...c, [p.code]: (c[p.code] ?? 0) + 1}), {})).map(([k, n]) => `${n} ${k}`).join(", ");
	const summary = packets.length ? `The console sent ${counts}.` : "The console didn't send anything back.";
	debugLog('USERLAYER', `${summary} Saved to ${file}`);
	return {ok: true, file, summary};
}

// How long to collect the console's reply to a User Layer request
const USER_LAYER_PROBE_MS = 4000;

export {discover, connect, auto_connect, show_opened, disconnect, write_cue, fire_sound_check, reset_console_state, sync_channel_monitor, get_console_status, consoleEvents,
	get_backup_status, toggle_backup, assign_spare, capture_channel_settings, read_channel_settings, get_line_levels, probe_user_layer};
