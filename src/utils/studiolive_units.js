/**
 * StudioLive Series III line parameters are sent as 0-1. These turn the stored channel settings
 * (gain / HPF / EQ / dynamics) back into the units the console shows. Ranges are from the Series
 * III owner's manual; the log curves are checked against Universal Control (HPF 0.322 = 80 Hz)
 * and the manual's default EQ (L-MID 0.3516 = 320 Hz, H-MID 0.588 = 1.4 kHz, Q 0.5 = 0.6).
 */

const log_scale = (x, min, max) => min * Math.pow(max / min, Math.min(1, Math.max(0, Number(x) || 0)));

const UNITS = {
	preamp_db: (x) => 60 * x,                                // 0 to 60 dB
	hpf_hz: (x) => x <= 0.001 ? null : log_scale(x, 24, 1000), // 24 Hz to 1 kHz; the bottom is off
	eq_hz: (x) => log_scale(x, 36, 18000),                   // 36 Hz to 18 kHz
	eq_db: (x) => (x - 0.5) * 30,                            // ±15 dB
	eq_q: (x) => log_scale(x, 0.1, 4),                       // 0.1 to 4
	gate_db: (x) => -84 + 84 * x,                            // -84 to 0 dB
	comp_db: (x) => -56 + 56 * x,                            // -56 to 0 dB
};

const format_hz = (hz) => hz === null ? "Off" : hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz` : `${Math.round(hz)} Hz`;
const format_db = (db) => `${db > 0.05 ? "+" : ""}${db.toFixed(1)} dB`;

/**
 * An EQ section's bands in console units
 * @param {Object} eq {"eq/eqgain1": 0.5, ...}
 * @returns {{on: boolean, bands: {band: Number, on: boolean, shelf: boolean, hz: Number, db: Number, q: Number}[]}}
 */
const eq_bands = (eq) => ({
	on: Number(eq?.['eq/eqallon']) >= 0.5,
	bands: [1, 2, 3, 4].map((band) => ({
		band,
		on: Number(eq?.[`eq/eqbandon${band}`] ?? 1) >= 0.5,
		// eqtype 1 is the default peaking band; 0 a shelf (bands 1 and 4)
		shelf: Number(eq?.[`eq/eqtype${band}`] ?? 1) < 0.5,
		hz: UNITS.eq_hz(eq?.[`eq/eqfreq${band}`] ?? 0.5),
		db: UNITS.eq_db(eq?.[`eq/eqgain${band}`] ?? 0.5),
		q: UNITS.eq_q(eq?.[`eq/eqq${band}`] ?? 0.5),
	})),
});

/**
 * Roughly the EQ's response in dB at a frequency, for drawing its curve: a bell per peaking band
 * (narrower with more Q) and a smooth step per shelf, summed. A picture, not the console's math.
 * @param {ReturnType<eq_bands>} eq
 * @param {Number} hz
 */
const eq_response = (eq, hz) => {
	// The curve keeps its shape when the EQ is switched off (drawn dimmed), so it can still be read
	let total = 0;
	for (const b of eq.bands) {
		if (!b.on || Math.abs(b.db) < 0.01) continue;
		const ratio = hz / b.hz;
		if (b.shelf) {
			// A smooth shelf: full gain past the corner (low shelf for band 1, high shelf for band 4)
			const t = b.band === 1 ? 1 / (1 + Math.pow(ratio, 2)) : 1 / (1 + Math.pow(1 / ratio, 2));
			total += b.db * t;
		} else {
			const x = Math.log2(ratio) * b.q * 2;
			total += b.db / (1 + x * x);
		}
	}
	return total;
}

export { UNITS, format_hz, format_db, eq_bands, eq_response };
