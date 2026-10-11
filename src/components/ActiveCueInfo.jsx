import React, { useEffect, useState } from 'react';

import { get_cue_color, ACTIVE_CUE_ACCENT, TEXT_COLOR } from './utils/colors.jsx';

const DEFAULT_SIZE = 48;
const SIZE_KEY = 'activeCueInfo.fontSize';

const PAGE_STYLE = {
	height: "100vh",
	boxSizing: "border-box",
	backgroundColor: "#1e1e1e",
	color: TEXT_COLOR,
	fontFamily: "Arial",
	padding: "12px 20px",
	display: "flex",
	flexDirection: "column",
	justifyContent: "center",
	gap: "0.3em",
	overflow: "hidden",
	userSelect: "none",
}

const LINE_STYLE = {display: "flex", alignItems: "baseline", gap: "0.5em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"};

const readSize = () => {
	try { return Number(localStorage.getItem(SIZE_KEY)) || DEFAULT_SIZE; } catch { return DEFAULT_SIZE; }
}

/**
 * View → Active Cue Info: a pop-out window showing the cue that's running (big) and the next
 * one, for a second screen or the stage manager. Scroll over the text to change its size;
 * double-click to reset it.
 */
const ActiveCueInfo = () => {
	const [info, setInfo] = useState(null);
	const [size, setSize] = useState(readSize);

	useEffect(() => {
		document.title = "Active Cue Info";
		window.cueInfoApi.get().then(setInfo);
		return window.cueInfoApi.onChange(setInfo);
	}, []);

	useEffect(() => {
		try { localStorage.setItem(SIZE_KEY, String(size)); } catch { /* size just isn't remembered */ }
	}, [size]);

	const onWheel = (e) => setSize((s) => Math.max(14, Math.min(200, s - Math.sign(e.deltaY) * 3)));

	const current = info?.current;
	const next = info?.next;

	return (
		<div style={{...PAGE_STYLE, fontSize: size}} onWheel={onWheel} onDoubleClick={() => setSize(DEFAULT_SIZE)} title="Scroll to change the text size; double-click to reset">
			<div style={{...LINE_STYLE, borderLeft: `0.15em solid ${ACTIVE_CUE_ACCENT}`, paddingLeft: "0.4em", backgroundColor: current ? get_cue_color(current.colour) : "transparent"}}>
				<b>{current?.number ?? "0"}</b>
				<span>{current?.name ?? "Line Checks"}</span>
				{info?.marked ? <span style={{fontSize: "0.4em", color: "#ff8a8a"}}>● marked</span> : null}
			</div>
			<div style={{...LINE_STYLE, fontSize: "0.55em", opacity: 0.7}}>
				<span>Next:</span>
				{next ? <><b>{next.number}</b><span>{next.name}</span></> : <span>—</span>}
			</div>
		</div>
	);
}

export default ActiveCueInfo;
