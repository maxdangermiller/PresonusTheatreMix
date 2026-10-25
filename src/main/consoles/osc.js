// main/consoles/osc.js
// Just enough OSC 1.0 for the X32: messages with int (i), float (f), string (s) and blob (b)
// arguments. Everything is big-endian and padded to 4 bytes.

/** A string, null-terminated and padded to a multiple of 4 bytes */
const pad_string = (text) => {
	const raw = Buffer.from(`${text}\0`, 'utf8');
	return Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4)]);
}

/**
 * Build an OSC message
 * @param {String} address e.g. "/ch/01/mix/fader"
 * @param {...(Number | String | {type: 'i' | 'f', value: Number})} args numbers are floats unless
 *   wrapped as {type: 'i', value}; strings are strings
 * @returns {Buffer}
 */
const encode = (address, ...args) => {
	const typed = args.map((arg) => typeof arg === 'string' ? {type: 's', value: arg}
		: typeof arg === 'number' ? {type: 'f', value: arg} : arg);
	const parts = [pad_string(address), pad_string(`,${typed.map((a) => a.type).join("")}`)];
	for (const {type, value} of typed) {
		if (type === 's') parts.push(pad_string(value));
		else {
			const b = Buffer.alloc(4);
			if (type === 'i') b.writeInt32BE(Math.round(value)); else b.writeFloatBE(value);
			parts.push(b);
		}
	}
	return Buffer.concat(parts);
}

/** An int argument for encode() */
const int = (value) => ({type: 'i', value});

/**
 * Read a string starting at offset
 * @returns {[String, Number]} the string and the offset after its padding
 */
const read_string = (buf, offset) => {
	let end = offset;
	while (end < buf.length && buf[end] !== 0) end++;
	const text = buf.toString('utf8', offset, end);
	return [text, offset + Math.ceil((end - offset + 1) / 4) * 4];
}

/**
 * Parse an OSC message
 * @param {Buffer} buf
 * @returns {{address: String, args: (Number | String | Buffer)[]} | null}
 */
const decode = (buf) => {
	try {
		const [address, after_address] = read_string(buf, 0);
		if (!address.startsWith('/')) return null;
		if (after_address >= buf.length) return {address, args: []};
		const [tags, after_tags] = read_string(buf, after_address);
		let offset = after_tags;
		const args = [];
		for (const tag of tags.slice(1)) {
			if (tag === 'i') { args.push(buf.readInt32BE(offset)); offset += 4; }
			else if (tag === 'f') { args.push(buf.readFloatBE(offset)); offset += 4; }
			else if (tag === 's') { const [s, next] = read_string(buf, offset); args.push(s); offset = next; }
			else if (tag === 'b') {
				const size = buf.readInt32BE(offset);
				args.push(buf.subarray(offset + 4, offset + 4 + size));
				offset += 4 + Math.ceil(size / 4) * 4;
			} else return {address, args};
		}
		return {address, args};
	} catch {
		return null;
	}
}

export { encode, decode, int };
