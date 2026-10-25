import React, { useEffect, useMemo, useRef, useState } from 'react';

import { BUTTON_STYLE } from './Dialog.jsx';
import { themed, ACTIVE_CUE_ACCENT, SELECTED_COLOR, ON_SELECTED_COLOR } from './utils/colors.jsx';
import { open_script } from './utils/pdf.js';
import { script_marks } from '../utils/show_edits.js';
import { format_cue_number } from '../utils/cue_number.js';

const PANEL_STYLE = {display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, borderLeft: `1px solid ${themed('border')}`, marginLeft: 10};
const BAR_STYLE = {display: "flex", alignItems: "center", gap: 10, padding: "4px 8px", fontSize: 13, flexShrink: 0, flexWrap: "wrap"};
const PAGES_STYLE = {flex: 1, overflowY: "auto", backgroundColor: themed('well'), padding: "8px 0"};
const NOTE_STYLE = {fontSize: 13, color: themed('textMuted'), padding: 16};
const SMALL_BUTTON = {...BUTTON_STYLE, fontSize: 12, padding: "1px 8px"};
// Gap between pages, and room on the left of each page for cue tags
const PAGE_GAP = 10;
const GUTTER = 46;

/**
 * One page: drawn when it's near the screen; cue tags in the gutter
 * @param {Object} props
 */
const Page = ({doc, number, width, marks, activeKey, selectedKey, cueText, onSelectCue, onMarkHere, pageRef}) => {
	const canvasRef = useRef(null);
	const boxRef = useRef(null);
	const [size, setSize] = useState(null);     // {w, h, scale} in CSS pixels
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		let current = true;
		doc.getPage(number).then((page) => {
			if (!current) return;
			const base = page.getViewport({scale: 1});
			const scale = (width - GUTTER) / base.width;
			setSize({w: width - GUTTER, h: base.height * scale, scale});
		});
		return () => { current = false; };
	}, [doc, number, width]);

	// Only draw pages near the screen
	useEffect(() => {
		const box = boxRef.current;
		if (!box) return;
		const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {rootMargin: "800px 0px"});
		observer.observe(box);
		return () => observer.disconnect();
	}, [size]);

	useEffect(() => {
		if (!visible || !size || !canvasRef.current) return;
		let task = null, current = true;
		doc.getPage(number).then((page) => {
			if (!current) return;
			const ratio = window.devicePixelRatio || 1;
			const viewport = page.getViewport({scale: size.scale * ratio});
			const canvas = canvasRef.current;
			canvas.width = viewport.width;
			canvas.height = viewport.height;
			task = page.render({canvasContext: canvas.getContext('2d'), viewport});
			task.promise.catch(() => {});
		});
		return () => { current = false; task?.cancel(); };
	}, [visible, size, doc, number]);

	if (!size) return <div style={{height: 600}}/>;

	/** Double-click: put the selected cue's mark here */
	const markHere = (event) => {
		const top = event.currentTarget.getBoundingClientRect().top;
		onMarkHere(number, (event.clientY - top) / size.scale);
	}

	return (
		<div ref={(el) => { boxRef.current = el; pageRef(number, el); }} style={{position: "relative", width, height: size.h, margin: `0 auto ${PAGE_GAP}px`}}>
			<div style={{position: "absolute", left: GUTTER, top: 0, width: size.w, height: size.h, backgroundColor: "#fff", boxShadow: `0 1px 4px ${themed('shadow')}`}} onDoubleClick={markHere} title="Double-click to mark the selected cue here">
				<canvas ref={canvasRef} style={{width: size.w, height: size.h, display: "block"}}/>
				{marks.filter((m) => m.key === activeKey).map((m) => (
					<div key="band" style={{position: "absolute", left: 0, right: 0, top: m.y * size.scale - 3, height: 40 * size.scale, backgroundColor: themed('activeTint'), borderLeft: `4px solid ${ACTIVE_CUE_ACCENT}`, pointerEvents: "none"}}/>
				))}
			</div>
			{marks.map((m) => {
				const active = m.key === activeKey, selected = m.key === selectedKey;
				return (
					<button
						key={m.key}
						data-cue-mark={m.key}
						onClick={() => onSelectCue(m.key)}
						title={`Cue ${m.label}: ${cueText(m.key)}`}
						style={{
							position: "absolute", left: 2, top: m.y * size.scale - 2, width: GUTTER - 6,
							fontSize: 11, fontWeight: "bold", padding: "1px 2px", borderRadius: 4, cursor: "pointer",
							border: `1px solid ${active ? ACTIVE_CUE_ACCENT : selected ? SELECTED_COLOR : themed('lineStrong')}`,
							backgroundColor: active ? ACTIVE_CUE_ACCENT : selected ? SELECTED_COLOR : themed('panel'),
							color: active ? "#000" : selected ? ON_SELECTED_COLOR : themed('text'),
							whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
						}}
					>{m.label}</button>
				);
			})}
		</div>
	);
}

/**
 * View → Script: the show's script beside the cue list, with each cue marked where it happens
 * (from File → Import Script, or double-click the script to mark the selected cue). Follows the
 * running cue.
 * @param {{show: Object, cues: Object[], activeKey: String | null, selectedKey: String | null,
 *   onSelectCue: Function, runEdit: Function, onImport: Function, width: Number}} props
 */
const ScriptView = ({show, cues, activeKey, selectedKey, onSelectCue, runEdit, onImport, width}) => {
	const file = show.consoleSetup?.scriptFile ?? null;
	const [doc, setDoc] = useState(null);
	const [error, setError] = useState("");
	const [follow, setFollow] = useState(true);
	const scrollRef = useRef(null);
	const pageEls = useRef(new Map());
	const pageWidth = Math.max(260, width - 28);

	useEffect(() => {
		setDoc(null);
		setError("");
		if (!file) return;
		let current = true;
		open_script(file).then(({doc: d}) => current && setDoc(d)).catch((e) => current && setError(e.message));
		return () => { current = false; };
	}, [file]);

	const marks = useMemo(() => {
		const all = script_marks(show);
		const byPage = new Map();
		for (const cue of cues) {
			const key = `${Number(cue.number)}.${Number(cue.point)}`;
			const mark = all[key];
			if (!mark) continue;
			if (!byPage.has(mark.page)) byPage.set(mark.page, []);
			byPage.get(mark.page).push({key, y: mark.y, label: format_cue_number(cue.number, cue.point)});
		}
		return byPage;
	}, [show, cues]);

	const cueText = (key) => cues.find((c) => `${Number(c.number)}.${Number(c.point)}` === key)?.name ?? "";

	/** Scroll a cue's mark into view, a third of the way down */
	const reveal = (key) => {
		const mark = script_marks(show)[key];
		const box = scrollRef.current, page = pageEls.current.get(mark?.page);
		if (!mark || !box || !page) return;
		const canvasHeight = page.getBoundingClientRect().height;
		doc?.getPage(mark.page).then((p) => {
			const scale = canvasHeight / p.getViewport({scale: 1}).height;
			box.scrollTo({top: page.offsetTop + mark.y * scale - box.clientHeight / 3, behavior: 'smooth'});
		});
	}

	// Follow the running cue
	useEffect(() => { if (follow && activeKey) reveal(activeKey); }, [activeKey, follow, doc]);

	const markHere = (page, y) => {
		if (!selectedKey) return;
		runEdit([{op: 'set_script_mark', cue: selectedKey, mark: {page, y: Math.max(0, y - 6)}}], {setup: true});
	}

	const selectedMarked = selectedKey && script_marks(show)[selectedKey];

	return (
		<div style={{...PANEL_STYLE, width, flexShrink: 0}} aria-label="Script">
			<div style={BAR_STYLE}>
				<b>Script</b>
				{doc ? <span style={{color: themed('textMuted')}}>{doc.numPages} pages</span> : null}
				<label style={{display: "flex", alignItems: "center", gap: 4}}><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)}/> Follow the cue</label>
				{selectedKey ? (
					<span style={{display: "flex", alignItems: "center", gap: 6}}>
						<button style={SMALL_BUTTON} disabled={!selectedMarked} onClick={() => reveal(selectedKey)}>Find cue {format_cue_number(...selectedKey.split(".").map(Number))}</button>
						<button style={SMALL_BUTTON} disabled={!selectedMarked} onClick={() => runEdit([{op: 'set_script_mark', cue: selectedKey, mark: null}], {setup: true})}>Unmark</button>
					</span>
				) : null}
				<button style={{...SMALL_BUTTON, marginLeft: "auto"}} onClick={onImport}>{file ? "Import Cues…" : "Import Script…"}</button>
			</div>
			<div ref={scrollRef} style={PAGES_STYLE}>
				{!file ? <div style={NOTE_STYLE}>No script yet. File → Import Script reads the show's script (a PDF), makes cues line by line and marks them on it.</div>
					: error ? <div style={{...NOTE_STYLE, color: themed('error')}}>{error}</div>
					: !doc ? <div style={NOTE_STYLE}>Opening the script…</div>
					: Array.from({length: doc.numPages}, (_, i) => i + 1).map((n) => (
						<Page
							key={n}
							doc={doc}
							number={n}
							width={pageWidth}
							marks={marks.get(n) ?? []}
							activeKey={activeKey}
							selectedKey={selectedKey}
							cueText={cueText}
							onSelectCue={onSelectCue}
							onMarkHere={markHere}
							pageRef={(num, el) => { if (el) pageEls.current.set(num, el); else pageEls.current.delete(num); }}
						/>
					))}
			</div>
			{doc ? <div style={{...BAR_STYLE, color: themed('textMuted'), fontSize: 12}}>Click a cue number to select the cue. Double-click the script to mark the selected cue there.</div> : null}
		</div>
	);
}

export default ScriptView;
