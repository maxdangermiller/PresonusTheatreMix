// main/reaper.js
// Link to REAPER (TheatreMix: Show Setup → REAPER), for recording a run and practising sections
// of the show against it (virtual soundcheck):
//  - while REAPER is recording, each cue fired drops a marker, and the cue's place in the
//    recording is remembered (saved in the show, so it lasts)
//  - while REAPER is stopped, firing a cue moves REAPER to that cue's place, less the pre-roll
// REAPER needs an OSC control surface (Preferences → Control/OSC/web → Add → OSC, "Default"
// pattern): mode "Local port", local listen port 8000, device IP = this computer, device port 9000.

import dgram from 'node:dgram';

import { encodeMessage, decodePacket } from './osc.js';
import { debugLog } from './debugLog.js';
import { getShow, setConsoleSetup } from './showManager.js';
import { cue_key } from '../utils/show_edits.js';

const REAPER_PORT = 8000;          // REAPER listens here
const FEEDBACK_PORT = 9000;        // REAPER sends its state here
const INSERT_MARKER_ACTION = 40157;   // "Markers: Insert marker at current position"

let socket = null;
let host = null;
let preRoll = 0;
let recording = false;
let playing = false;
let position = 0;         // REAPER's play position (s), from its feedback
let heardFrom = false;

const send = (address, args = []) => {
	if (!socket || !host) return;
	socket.send(encodeMessage(address, args), REAPER_PORT, host);
}

/** {cue key: seconds}, kept in the show (consoleSetup.reaperMarkers) */
const readMarkers = () => {
	try { return JSON.parse(getShow()?.consoleSetup?.reaperMarkers || "{}"); } catch { return {}; }
}

const handleFeedback = (buf) => {
	let messages;
	try { messages = decodePacket(buf); } catch { return; }
	for (const {address, args} of messages) {
		const value = Number(args[0]);
		if (address === '/time' && Number.isFinite(value)) position = value;
		else if (address === '/record') recording = value >= 0.5;
		else if (address === '/play') playing = value >= 0.5;
		else continue;
		if (!heardFrom) {
			heardFrom = true;
			debugLog('REAPER', `REAPER is talking to us (${host})`);
		}
	}
}

const stop = () => {
	if (socket) {
		socket.close();
		socket = null;
		debugLog('REAPER', "Not linked to REAPER");
	}
	heardFrom = false;
}

/**
 * Follow the show's REAPER settings (call when the show changes)
 * @param {Object | null} show
 */
const syncReaper = (show) => {
	const config = show?.config ?? {};
	const enabled = config.dawRemote === "1";
	host = config.dawIP || "127.0.0.1";
	preRoll = Math.max(0, Number(config.dawPreRoll) || 0);

	if (!enabled) { stop(); return; }
	if (socket) return;

	socket = dgram.createSocket({type: 'udp4', reuseAddr: true});
	socket.on('message', handleFeedback);
	socket.on('error', (error) => {
		debugLog('REAPER', `Can't listen for REAPER on port ${FEEDBACK_PORT}: ${error.message}`);
		stop();
	});
	socket.bind(FEEDBACK_PORT, () => {
		debugLog('REAPER', `Linked to REAPER at ${host}:${REAPER_PORT}, listening on ${FEEDBACK_PORT}`);
		// Ask for its state
		send('/device/marker/count', [0]);
	});
}

/**
 * A cue was fired (null: Line Checks)
 * @param {Object | null} cue
 */
const reaperCueFired = (cue) => {
	if (!socket || cue === null) return;
	const key = cue_key(cue);

	if (recording) {
		send('/action', [INSERT_MARKER_ACTION]);
		const markers = {...readMarkers(), [key]: Number(position.toFixed(3))};
		setConsoleSetup('reaperMarkers', JSON.stringify(markers));
		debugLog('REAPER', `Cue ${key}: marker at ${position.toFixed(2)}s`);
	} else if (!playing) {
		const at = readMarkers()[key];
		if (at === undefined) {
			debugLog('REAPER', `Cue ${key}: no marker recorded for it yet`);
			return;
		}
		const target = Math.max(0, at - preRoll);
		send('/time', [{type: 'f', value: target}]);
		debugLog('REAPER', `Cue ${key}: REAPER to ${target.toFixed(2)}s (marker ${at.toFixed(2)}s, pre-roll ${preRoll}s)`);
	}
}

const getReaperStatus = () => ({linked: socket !== null, heardFrom, recording, playing, position});

export { syncReaper, reaperCueFired, getReaperStatus, REAPER_PORT, FEEDBACK_PORT };
