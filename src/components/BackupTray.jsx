import React, { useEffect, useState } from 'react';

import { INPUT_STYLE } from './Dialog.jsx';
import { BORDER_COLOR, themed } from './utils/colors.jsx';

const TRAY_STYLE = {
	display: "flex",
	alignItems: "center",
	gap: 18,
	padding: "6px 12px",
	backgroundColor: themed('cueList'),
	border: "1px solid " + BORDER_COLOR,
	borderTop: "none",
	fontFamily: "Arial",
	fontSize: 15,
	overflowX: "auto",
	whiteSpace: "nowrap",
	userSelect: "none",
}

const ACTIVE = {color: themed('ok'), fontWeight: "bold"};
const STANDBY = {color: themed('textFaint')};

/**
 * The backup tray under the cue list (TheatreMix): each channel with a backup, the one carrying
 * it in green and the standby in gray. Double-click a pair to switch it. The spare backup can be
 * stood in for any show channel.
 * @param {{show: Object}} props
 */
const BackupTray = ({show}) => {
	const [status, setStatus] = useState({pairs: [], spare: null, spareFor: null});

	useEffect(() => {
		window.presonus.getBackups().then(setStatus);
		return window.presonus.onBackups(setStatus);
	}, []);

	const fixed = status.pairs.filter((p) => !p.spare);
	if (!fixed.length && !status.spare) return null;

	const channels = String(show?.config?.channels ?? "").split(",").map(Number).filter((ch) => ch > 0);
	const name = (ch) => show?.profiles?.find((p) => Number(p.channel) === ch && Number(p.default) === 1)?.name || `Ch ${ch}`;

	return (
		<div style={TRAY_STYLE} role="toolbar" aria-label="Backup channels">
			<span style={{opacity: 0.6, fontSize: 13}}>Backups</span>
			{status.pairs.map((p) => (
				<span
					key={p.main}
					onDoubleClick={() => window.presonus.toggleBackup(p.main).then(setStatus)}
					title={`Double-click to switch ${p.label} to ${p.switched ? "its own channel" : `backup channel ${p.backup}`} (or press its DCA's mute button)`}
					style={{cursor: "pointer"}}
				>
					{p.label}{" "}
					<span style={p.switched ? STANDBY : ACTIVE}>{p.main}</span>
					{" ⇄ "}
					<span style={p.switched ? ACTIVE : STANDBY}>{p.spare ? `spare ${p.backup}` : p.backup}</span>
				</span>
			))}
			{status.spare ? (
				<label style={{display: "flex", alignItems: "center", gap: 6}}>
					<span style={{opacity: 0.6, fontSize: 13}}>Spare {status.spare} for</span>
					<select
						value={status.spareFor ?? ""}
						onChange={(e) => window.presonus.assignSpare(e.target.value === "" ? null : Number(e.target.value)).then(setStatus)}
						style={{...INPUT_STYLE, padding: "1px 4px", fontSize: 13}}
						aria-label="Stand the spare backup in for"
					>
						<option value="">nobody</option>
						{channels.map((ch) => <option key={ch} value={ch}>{ch} {name(ch)}</option>)}
					</select>
				</label>
			) : null}
		</div>
	);
}

export default BackupTray;
