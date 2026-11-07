export type MediaType = 'png' | 'jpeg' | 'mp4' | 'webm';

/** An EBML variable-length integer at `at`: its length and value, and whether it is the unknown-size marker. */
function vint(b: Buffer, at: number): { len: number; value: number; unknown: boolean } | undefined {
  if (at >= b.length) return undefined;
  let len = 1, mask = 0x80;
  while (len <= 8 && !(b[at]! & mask)) { len++; mask >>= 1; }
  if (len > 8 || at + len > b.length) return undefined;
  let value = BigInt(b[at]! & (mask - 1));
  for (let i = 1; i < len; i++) value = (value << 8n) | BigInt(b[at + i]!);
  return { len, value: Number(value), unknown: value === (1n << BigInt(7 * len)) - 1n };
}
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

/** The media type the leading bytes show, if any. */
export function detect(bytes: Uint8Array): MediaType | undefined {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  if (b.subarray(0, 4).equals(EBML)) {
    // A WebM (a journey's video, #37): an EBML header whose DocType is webm.
    const size = vint(b, 4);
    if (size && !size.unknown && b.toString('latin1', 4 + size.len, 4 + size.len + size.value).includes('webm')) return 'webm';
  }
  return undefined;
}

/** What a file of this type lacks at its end, or undefined when it is whole. */
export function missingEnd(type: MediaType, bytes: Uint8Array): string | undefined {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 'jpeg') return b.length >= 4 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9 ? undefined : 'EOI (the end-of-image marker)';
  if (type === 'png') {
    for (let at = 8; at + 12 <= b.length; at += 12 + b.readUInt32BE(at)) {
      if (at + 12 + b.readUInt32BE(at) > b.length) break;
      if (b.toString('latin1', at + 4, at + 8) === 'IEND') return undefined;
    }
    return 'IEND';
  }
  if (type === 'webm') {
    // WebM: the Segment's size is written once the recording is finalized, and header plus size must reach the file's end.
    const header = vint(b, 4);
    const at = header ? 4 + header.len + header.value : b.length;
    const id = vint(b, at);
    const size = id ? vint(b, at + id.len) : undefined;
    if (!id || !size || b.toString('hex', at, at + id.len) !== '18538067') return 'the Segment element';
    if (size.unknown) return "the Segment's size, which a recording still being written has not yet";
    return at + id.len + size.len + size.value === b.length ? undefined : 'the end of the Segment element';
  }
  // MP4: boxes must add up to the file, with a moov box among them.
  let at = 0;
  let moov = false;
  while (at + 8 <= b.length) {
    const small = b.readUInt32BE(at);
    const size = small === 1 && at + 16 <= b.length ? Number(b.readBigUInt64BE(at + 8)) : small === 0 ? b.length - at : small;
    if (size < 8 || at + size > b.length) return moov ? `the end of the ${b.toString('latin1', at + 4, at + 8)} box` : 'moov';
    moov ||= b.toString('latin1', at + 4, at + 8) === 'moov';
    at += size;
  }
  return !moov ? 'moov' : at === b.length ? undefined : 'the end of the last box';
}
