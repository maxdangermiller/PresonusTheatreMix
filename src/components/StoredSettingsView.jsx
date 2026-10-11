import React from 'react';

import { UNITS, format_hz, format_db, eq_bands, eq_response } from '../utils/studiolive_units.js';

const GRAPH_W = 420;
const GRAPH_H = 110;
const MIN_HZ = 20;
const MAX_HZ = 20000;
const RANGE_DB = 15;

const PANEL_STYLE = {display: "flex", gap: 16, alignItems: "flex-start", fontSize: 13, flexWrap: "wrap"};
const BLOCK_STYLE = {display: "flex", flexDirection: "column", gap: 4};
const LABEL_STYLE = {opacity: 0.6, fontSize: 12};
const CELL = {padding: "1px 8px", textAlign: "right", whiteSpace: "nowrap"};

const x_of = (hz) => GRAPH_W * Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ);
const y_of = (db) => GRAPH_H / 2 - (db / RANGE_DB) * (GRAPH_H / 2 - 4);

/** The EQ curve over a 20 Hz - 20 kHz, ±15 dB grid */
const EqCurve = ({eq}) => {
	const points = [];
	for (let i = 0; i <= 120; i++) {
		const hz = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, i / 120);
		points.push(`${x_of(hz).toFixed(1)},${y_of(eq_response(eq, hz)).toFixed(1)}`);
	}
	return (
		<svg width={GRAPH_W} height={GRAPH_H} style={{backgroundColor: "#0d0d0d", border: "1px solid #444"}} role="img" aria-label="EQ curve">
			{[100, 1000, 10000].map((hz) => <line key={hz} x1={x_of(hz)} x2={x_of(hz)} y1={0} y2={GRAPH_H} stroke="#2c2c2c"/>)}
			{[-10, 0, 10].map((db) => <line key={db} x1={0} x2={GRAPH_W} y1={y_of(db)} y2={y_of(db)} stroke={db === 0 ? "#444" : "#2c2c2c"}/>)}
			{[[100, "100"], [1000, "1k"], [10000, "10k"]].map(([hz, t]) => <text key={hz} x={x_of(hz) + 3} y={GRAPH_H - 4} fill="#777" fontSize="10">{t}</text>)}
			<polyline points={points.join(" ")} fill="none" stroke={eq.on ? "#4fc3f7" : "#666"} strokeWidth="2"/>
			{eq.bands.filter((b) => b.on).map((b) => <circle key={b.band} cx={x_of(b.hz)} cy={y_of(eq.on ? b.db : 0)} r="3.5" fill={eq.on ? "#fff" : "#666"}/>)}
		</svg>
	);
}

/**
 * Stored StudioLive settings for a profile / actor, in the console's units
 * @param {{settings: Object<string, Object>}} props section -> {param: 0-1 value}
 */
const StoredSettingsView = ({settings}) => {
	const {gain, hpf, eq, dyn} = settings ?? {};
	if (!gain && !hpf && !eq && !dyn) return <div style={{fontSize: 13, opacity: 0.6}}>Nothing stored.</div>;
	const bands = eq ? eq_bands(eq) : null;

	return (
		<div style={PANEL_STYLE}>
			{gain || hpf ? <div style={BLOCK_STYLE}>
				{gain ? <div><span style={LABEL_STYLE}>Gain </span>{UNITS.preamp_db(gain.preampgain ?? 0).toFixed(1)} dB</div> : null}
				{hpf ? <div><span style={LABEL_STYLE}>HPF </span>{format_hz(UNITS.hpf_hz(hpf['filter/hpf'] ?? 0))}</div> : null}
			</div> : null}

			{bands ? <div style={BLOCK_STYLE}>
				<div><span style={LABEL_STYLE}>EQ </span>{bands.on ? "On" : "Off"}</div>
				<EqCurve eq={bands}/>
			</div> : null}

			{bands ? <table style={{borderCollapse: "collapse", alignSelf: "flex-end"}}>
				<thead>
					<tr style={LABEL_STYLE}><td style={CELL}>Band</td><td style={CELL}>Freq</td><td style={CELL}>Gain</td><td style={CELL}>Q</td></tr>
				</thead>
				<tbody>
					{bands.bands.map((b) => (
						<tr key={b.band} style={{opacity: b.on ? 1 : 0.45}}>
							<td style={CELL}>{["Low", "Low-Mid", "High-Mid", "High"][b.band - 1]}{b.shelf ? " (shelf)" : ""}{b.on ? "" : " off"}</td>
							<td style={CELL}>{format_hz(b.hz)}</td>
							<td style={CELL}>{format_db(b.db)}</td>
							<td style={CELL}>{b.shelf ? "-" : b.q.toFixed(2)}</td>
						</tr>
					))}
				</tbody>
			</table> : null}

			{dyn ? <div style={BLOCK_STYLE}>
				<div><span style={LABEL_STYLE}>Gate </span>{Number(dyn['gate/on']) >= 0.5 ? `On, ${UNITS.gate_db(dyn['gate/threshold'] ?? 0).toFixed(1)} dB` : "Off"}</div>
				<div><span style={LABEL_STYLE}>Comp </span>{Number(dyn['comp/on']) >= 0.5 ? `On, ${UNITS.comp_db(dyn['comp/threshold'] ?? 1).toFixed(1)} dB` : "Off"}</div>
				<div><span style={LABEL_STYLE}>Limiter </span>{Number(dyn['limit/limiteron']) >= 0.5 ? "On" : "Off"}</div>
			</div> : null}
		</div>
	);
}

export default StoredSettingsView;
