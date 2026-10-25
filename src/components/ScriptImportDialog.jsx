import React, { useEffect, useMemo, useState } from 'react';

import Dialog, { BUTTON_STYLE, INPUT_STYLE, ERROR_STYLE } from './Dialog.jsx';
import { themed } from './utils/colors.jsx';
import { open_script, script_lines } from './utils/pdf.js';
import { parse_script, split_names } from '../utils/script_parse.js';
import { make_cues, guess_match, match_targets } from '../utils/script_cues.js';
import { show_dcas, cue_value, default_profile } from '../utils/show_edits.js';
import { format_cue_number } from '../utils/cue_number.js';

const BOX_STYLE = {border: `1px solid ${themed('lineStrong')}`, backgroundColor: themed('panel'), overflowY: "auto", minHeight: 0};
const HEAD_STYLE = {textAlign: "left", fontWeight: "normal", fontSize: 12, color: themed('textMuted'), padding: "4px 6px", borderBottom: `1px solid ${themed('line')}`, position: "sticky", top: 0, backgroundColor: themed('panel')};
const CELL_STYLE = {padding: "2px 6px", fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"};
const NOTE_STYLE = {fontSize: 12, color: themed('textMuted')};
const OPTION_STYLE = {display: "flex", alignItems: "center", gap: 6, fontSize: 14};

/**
 * File → Import Script...: read the show's script (a PDF), match its characters to the show,
 * and make cues line by line (utils/script_cues.js). The cues are marked on the script for
 * the Script view and the annotated copy.
 * @param {{show: Object, runEdit: Function, onClose: Function}} props
 */
const ScriptImportDialog = ({show, runEdit, onClose}) => {
	const [file, setFile] = useState(show.consoleSetup?.scriptFile ?? null);
	const [status, setStatus] = useState("");
	const [error, setError] = useState("");
	const [events, setEvents] = useState(null);
	const [map, setMap] = useState(() => { try { return JSON.parse(show.consoleSetup?.scriptMap || "{}"); } catch { return {}; } });
	const [replace, setReplace] = useState(false);
	const [songs, setSongs] = useState(true);
	const [layout, setLayout] = useState('typewriter');
	const [busy, setBusy] = useState(false);

	// Read the script whenever it changes
	useEffect(() => {
		if (!file) return;
		let current = true;
		setEvents(null);
		setError("");
		setStatus("Reading the script…");
		(async () => {
			try {
				const {doc} = await open_script(file);
				const {lines, scanned, error: ocrError} = await script_lines(file, ({done, total}) => {
					if (current) setStatus(`Reading scanned pages: ${done} of ${total}…`);
				});
				if (!current) return;
				const parsed = parse_script(lines);
				setEvents(parsed);
				const lines_count = parsed.filter((e) => e.type === 'speech' || e.type === 'sing').length;
				setStatus(`${doc.numPages} pages${scanned ? ` (${scanned} scanned)` : ""}: ${parsed.filter((e) => e.type === 'scene').length} scenes, ${parsed.filter((e) => e.type === 'song').length} songs, ${lines_count} lines.`);
				if (ocrError) setError(`Some pages are scanned and couldn't be read: ${ocrError}`);
				else if (!lines_count) setError("No lines found. This reads scripts with each character's name in capitals, above their lines or before them (\"SARAH: …\").");
			} catch (e) {
				if (current) { setError(e.message); setStatus(""); }
			}
		})();
		return () => { current = false; };
	}, [file]);

	// Every name in the script, most lines first, with the show's guess for each
	const names = useMemo(() => {
		if (!events) return [];
		const counts = new Map();
		for (const e of events) {
			if (!e.name) continue;
			for (const n of split_names(e.name)) counts.set(n, (counts.get(n) ?? 0) + 1);
		}
		return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({name, count, guess: guess_match(show, name)}));
	}, [events, show]);

	const effectiveMap = useMemo(() => Object.fromEntries(names.map(({name, guess}) => [name, map[name] ?? guess])), [names, map]);
	const targets = useMemo(() => match_targets(show), [show]);

	// Append: after the last cue (the next whole number)
	const lastWhole = useMemo(() => Math.floor(Math.max(0, ...(show.cues ?? []).map(cue_value)) / 100), [show]);
	const preview = useMemo(() => {
		if (!events) return null;
		try {
			return make_cues(show, events, effectiveMap, {dcas: show_dcas(show), start: replace ? 1 : lastWhole + 1, songs, layout});
		} catch (e) {
			return {error: e.message};
		}
	}, [events, effectiveMap, replace, songs, layout, show, lastWhole]);

	const choose = async () => {
		const picked = await window.scriptApi.choose();
		if (picked) setFile(picked);
	}

	const create = async () => {
		if (!preview?.cues?.length || busy) return;
		setBusy(true);
		const ok = await runEdit([
			{op: 'set_script', file, map: effectiveMap},
			{op: 'add_cues', replace, cues: preview.cues.map(({number, point, name, dcas, mark}) => ({number, point, name, dcas, mark}))},
		], {setup: true});
		setBusy(false);
		if (ok) onClose();
	}

	/** A DCA in the preview: its label, or the character on it */
	const dcaText = (d) => {
		if (d.label) return d.label;
		const ch = d.channels[0];
		const p = d.profiles[ch] !== undefined ? show.profiles.find((x) => x.id === d.profiles[ch]) : default_profile(show, ch);
		return p?.name || `ch ${d.channels.join(",")}`;
	}

	return (
		<Dialog
			title="Import Script"
			subtitle="Make cues line by line from the show's script, and mark them on it"
			width={1000}
			fill
			onCancel={onClose}
			onSubmit={create}
			submitLabel={busy ? "Making cues…" : preview?.cues ? `Make ${preview.cues.length} Cues` : "Make Cues"}
		>
			<div style={{display: "flex", alignItems: "center", gap: 10, flexShrink: 0}}>
				<button style={BUTTON_STYLE} onClick={choose}>{file ? "Choose another…" : "Choose Script PDF…"}</button>
				<span style={{fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}} title={file ?? ""}>{file ? file.split("/").pop() : "No script chosen"}</span>
				<span style={NOTE_STYLE}>{status}</span>
			</div>
			{error ? <div style={ERROR_STYLE}>{error}</div> : null}

			{names.length ? (
				<div style={{display: "grid", gridTemplateColumns: "minmax(250px, 34%) 1fr", gap: 14, flex: 1, minHeight: 0}}>
					<div style={{display: "flex", flexDirection: "column", gap: 6, minHeight: 0}}>
						<div style={{fontSize: 14}}>Who's who: match each name in the script</div>
						<div style={{...BOX_STYLE, flex: 1}}>
							<table style={{width: "100%", borderCollapse: "collapse", tableLayout: "fixed"}}>
								<thead><tr><th style={{...HEAD_STYLE, width: "44%"}}>In the script</th><th style={HEAD_STYLE}>In the show</th></tr></thead>
								<tbody>
									{names.map(({name, count}) => {
										const value = effectiveMap[name] ?? "";
										return (
											<tr key={name}>
												<td style={{...CELL_STYLE, color: value ? undefined : themed('warn')}} title={`${count} line${count === 1 ? "" : "s"}`}>{name} <span style={NOTE_STYLE}>({count})</span></td>
												<td style={{padding: "1px 4px"}}>
													<select value={value} onChange={(e) => setMap((prev) => ({...prev, [name]: e.target.value}))} style={{...INPUT_STYLE, width: "100%", padding: "1px 4px", fontSize: 13}} aria-label={`${name} is`}>
														<option value="">Choose…</option>
														{targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
													</select>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
						<div style={NOTE_STYLE}>From Show Setup: the characters (profiles) and ensembles as you've set them up. Names left on "Choose…" are skipped. Saved with the show for next time.</div>
					</div>

					<div style={{display: "flex", flexDirection: "column", gap: 8, minHeight: 0}}>
						<div style={NOTE_STYLE}>
							{layout === 'principal'
								? "Principal bank: the characters with the most lines each keep their own DCA all show (most lines on DCA 1). Everyone else takes the DCAs left over, and borrows a principal's only while that principal isn't in the scene."
								: "Line by line, typewriter style: in each scene or song the first voice is on DCA 1, the next new voice on DCA 2, and so on."}
							{" "}When the DCAs run out, the next cue is prepped on the last line before it (whoever's talking keeps their DCA). Cues come at songs, scenes, entrances and exits, and when the DCAs run out.
						</div>
						{preview?.principals?.length ? (
							<div style={{...NOTE_STYLE, color: themed('text')}}>
								Principal bank: {preview.principals.map(({key, dca}) => `${dca} ${targets.find((t) => t.id === key)?.label.replace(/ \(ch \d+\)$/, "") ?? key}`).join(" · ")}
							</div>
						) : null}
						<div style={{display: "flex", flexWrap: "wrap", gap: "6px 16px"}}>
							<label style={OPTION_STYLE}>
								Layout
								<select value={layout} onChange={(e) => setLayout(e.target.value)} style={{...INPUT_STYLE, padding: "1px 4px", fontSize: 13}} aria-label="DCA layout">
									<option value="typewriter">Typewriter (first voice on DCA 1)</option>
									<option value="principal">Principal bank (principals keep their DCA)</option>
								</select>
							</label>
							<label style={OPTION_STYLE}><input type="checkbox" checked={songs} onChange={(e) => setSongs(e.target.checked)}/> A cue for each song</label>
							<label style={OPTION_STYLE}><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)}/> Replace the cue list</label>
						</div>
						<div style={{...NOTE_STYLE, color: replace ? themed('warn') : undefined}}>
							{replace
								? `Every cue but Line Checks is deleted first (Undo puts them back).`
								: `Added after the last cue (from cue ${lastWhole + 1}). Songs are numbered by their song number when they can be.`}
							{" "}DCAs used: {show_dcas(show).join(", ")}.
						</div>
						{preview?.error ? <div style={ERROR_STYLE}>{preview.error}</div> : null}
						{preview?.unmatched?.length ? <div style={{...NOTE_STYLE, color: themed('warn')}}>Skipped (not matched): {preview.unmatched.join(", ")}</div> : null}
						<div style={{...BOX_STYLE, flex: 1}}>
							<table style={{width: "100%", borderCollapse: "collapse", tableLayout: "fixed"}}>
								<thead><tr>
									<th style={{...HEAD_STYLE, width: 48}}>Cue</th>
									<th style={{...HEAD_STYLE, width: "40%"}}>Text</th>
									<th style={HEAD_STYLE}>DCAs</th>
									<th style={{...HEAD_STYLE, width: 34}}>Pg</th>
								</tr></thead>
								<tbody>
									{(preview?.cues ?? []).map((c) => (
										<tr key={`${c.number}.${c.point}`} style={{fontWeight: c.kind === 'song' ? "bold" : "normal"}}>
											<td style={CELL_STYLE}>{format_cue_number(c.number, c.point)}</td>
											<td style={CELL_STYLE} title={c.name}>{c.name}</td>
											<td style={{...CELL_STYLE, whiteSpace: "normal", fontSize: 12}} title={c.dcas.map((d) => `${d.dca}: ${dcaText(d)}`).join("\n")}>{c.dcas.map((d) => `${d.dca} ${dcaText(d)}`).join(" · ") || "—"}</td>
											<td style={CELL_STYLE}>{c.mark.page}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			) : (
				<div style={{...NOTE_STYLE, fontSize: 14, padding: "20px 0"}}>
					{file ? (events ? "" : "Reading…") : "Choose the show's script. It reads PDFs with each character's name in capitals above their lines, like the scripts MTI, Broadway Junior and most publishers send."}
				</div>
			)}
		</Dialog>
	);
}

export default ScriptImportDialog;
