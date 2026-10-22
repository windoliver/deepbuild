// OTLP export requests, read into one plain shape from either encoding OTLP/HTTP allows: binary protobuf
// (opentelemetry-proto's field numbers, decoded here with no dependency) and the OTLP/JSON mapping
// (lowerCamelCase, hex IDs, 64-bit integers as decimal strings or numbers). Only what the receiver maps is
// read: span and log names, IDs, times and scalar attributes, with the resource's attributes under them.
// A record's attributes take its resource's as their prototype, never a copy: an export of many records under
// a resource with many attributes would otherwise cost their product. `for…in` lists both.

export type Scalar = string | number | boolean;
export type Attrs = Record<string, Scalar>;
export interface Span { traceId: string; spanId: string; parentSpanId: string; name: string; startMs: number; endMs: number; attrs: Attrs }
export interface Log { timeMs: number; body: string | null; attrs: Attrs }

export class WireError extends Error {}

// ---- Protobuf ----------------------------------------------------------------------------------------------
// Read in place: every message is a range of the one request buffer, so decoding allocates only what it keeps.
/** Calls `visit` for each field of buf[start, end): a varint's value, or a length-delimited or fixed field's range. */
function fields(buf: Buffer, start: number, end: number, visit: (field: number, wire: number, value: number, to: number) => void): void {
  let pos = start;
  const varint = (): number => {
    let result = 0, scale = 1;
    for (;;) {
      if (pos >= end) throw new WireError('a varint runs past the end of its message');
      const b = buf[pos++]!;
      result += (b & 0x7f) * scale;
      if (b < 0x80) return result;
      scale *= 128;
      if (scale > 2 ** 70) throw new WireError('a varint is longer than ten bytes');
    }
  };
  const take = (n: number): number => {
    if (pos + n > end) throw new WireError('a field runs past the end of its message');
    const at = pos;
    pos += n;
    return at;
  };
  while (pos < end) {
    const key = varint(), field = Math.floor(key / 8), wire = key % 8;
    if (wire === 0) visit(field, wire, varint(), pos);
    else if (wire === 1) visit(field, wire, take(8), pos);
    else if (wire === 2) visit(field, wire, take(varint()), pos);
    else if (wire === 5) visit(field, wire, take(4), pos);
    else throw new WireError(`wire type ${wire} is not one OTLP uses`);
  }
}
/** A fixed64 nanosecond time at `at`, in milliseconds. */
const nanosMs = (buf: Buffer, wire: number, at: number): number => {
  if (wire !== 1) throw new WireError('a time field is not fixed64');
  return Math.floor((buf.readUInt32LE(at + 4) * 2 ** 32 + buf.readUInt32LE(at)) / 1e6);
};
const delimited = (wire: number): void => {
  if (wire !== 2) throw new WireError('a length-delimited field arrived with another wire type');
};
const str = (buf: Buffer, wire: number, at: number, to: number): string => { delimited(wire); return buf.toString('utf8', at, to); };
const hex = (buf: Buffer, wire: number, at: number, to: number): string => { delimited(wire); return buf.toString('hex', at, to); };

/** An AnyValue's scalar; an array, a key-value list or bytes reads as nothing. */
function anyValue(buf: Buffer, start: number, end: number): Scalar | undefined {
  let out: Scalar | undefined;
  fields(buf, start, end, (field, wire, v, to) => {
    if (field === 1) out = str(buf, wire, v, to);
    else if (field === 2 && wire === 0) out = v !== 0;
    else if (field === 3 && wire === 0) out = v;
    else if (field === 4 && wire === 1) out = buf.readDoubleLE(v);
  });
  return out;
}
function keyValue(buf: Buffer, start: number, end: number, into: Attrs): void {
  let key: string | undefined, value: Scalar | undefined;
  fields(buf, start, end, (field, wire, v, to) => {
    if (field === 1) key = str(buf, wire, v, to);
    else if (field === 2) { delimited(wire); value = anyValue(buf, v, to); }
  });
  if (key !== undefined && value !== undefined) into[key] = value;
}
function attributes(buf: Buffer, wire: number, v: number, to: number, into: Attrs): void {
  delimited(wire);
  keyValue(buf, v, to, into);
}

/** A span, decoded past its name only when `wanted` takes that name: most of an export is spans the receiver doesn't map. */
function protoSpan(buf: Buffer, start: number, end: number, base: Attrs, wanted: (name: string) => boolean): Span | null {
  let name = '';
  fields(buf, start, end, (field, wire, v, to) => { if (field === 5) name = str(buf, wire, v, to); });
  if (!wanted(name)) return null;
  const s: Span = { traceId: '', spanId: '', parentSpanId: '', name, startMs: 0, endMs: 0, attrs: Object.create(base) as Attrs };
  fields(buf, start, end, (field, wire, v, to) => {
    if (field === 1) s.traceId = hex(buf, wire, v, to);
    else if (field === 2) s.spanId = hex(buf, wire, v, to);
    else if (field === 4) s.parentSpanId = hex(buf, wire, v, to);
    else if (field === 7) s.startMs = nanosMs(buf, wire, v);
    else if (field === 8) s.endMs = nanosMs(buf, wire, v);
    else if (field === 9) attributes(buf, wire, v, to, s.attrs);
  });
  return s;
}
function protoLog(buf: Buffer, start: number, end: number, base: Attrs): Log {
  const l: Log = { timeMs: 0, body: null, attrs: Object.create(base) as Attrs };
  let observed = 0;
  fields(buf, start, end, (field, wire, v, to) => {
    if (field === 1) l.timeMs = nanosMs(buf, wire, v);
    else if (field === 11) observed = nanosMs(buf, wire, v);
    else if (field === 5) { delimited(wire); const body = anyValue(buf, v, to); l.body = typeof body === 'string' ? body : null; }
    else if (field === 6) attributes(buf, wire, v, to, l.attrs);
  });
  if (!l.timeMs) l.timeMs = observed;
  return l;
}
/** ExportTraceServiceRequest / ExportLogsServiceRequest: resource, then scope, then the records. */
function protoRequest<T>(buf: Buffer, read: (start: number, end: number, base: Attrs) => T | null): T[] {
  const out: T[] = [];
  fields(buf, 0, buf.length, (field, wire, top, topEnd) => {
    if (field !== 1) return;
    delimited(wire);
    const base: Attrs = {};
    const scopes: Array<[number, number]> = [];
    fields(buf, top, topEnd, (f, w, v, to) => {
      if (f === 1) { delimited(w); fields(buf, v, to, (rf, rw, rv, rto) => { if (rf === 1) attributes(buf, rw, rv, rto, base); }); }
      else if (f === 2) { delimited(w); scopes.push([v, to]); }
    });
    for (const [s, e] of scopes) {
      fields(buf, s, e, (f, w, v, to) => {
        if (f !== 2) return;
        delimited(w);
        const r = read(v, to, base);
        if (r) out.push(r);
      });
    }
  });
  return out;
}

// ---- OTLP/JSON ---------------------------------------------------------------------------------------------
type Json = { [key: string]: unknown };
/** A present resource must be an object: anything else would read as one with no attributes, and its records would lose their session. */
const resourceOf = (v: unknown): Json => {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new WireError('resource is not an object');
  return v as Json;
};
// The envelope and the attributes are read strictly: a collection that is there but not a list, an entry that isn't
// an object, or a value that isn't an AnyValue is a malformed export, refused, never read as an empty one (or a
// record with no cost) the exporter would take for delivered.
const entries = (v: unknown, what: string): Json[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new WireError(`${what} is not a list`);
  return v.map((e) => {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) throw new WireError(`an entry of ${what} is not an object`);
    return e as Json;
  });
};
const jsonMs = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? Math.floor(n / 1e6) : 0;
};
function jsonValue(v: unknown): Scalar | undefined {
  // null is the JSON mapping's default for any field: an absent value, as an absent field is.
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw new WireError('a value is not an AnyValue object');
  const o = v as Json;
  if (typeof o.stringValue === 'string') return o.stringValue;
  if (typeof o.boolValue === 'boolean') return o.boolValue;
  if (typeof o.intValue === 'string' || typeof o.intValue === 'number') { const n = Number(o.intValue); return Number.isFinite(n) ? n : undefined; }
  if (typeof o.doubleValue === 'number') return o.doubleValue;
  return undefined;
}
function jsonAttrs(v: unknown, into: Attrs): Attrs {
  for (const kv of entries(v, 'attributes')) {
    const { key, value } = kv;
    if (typeof key !== 'string') throw new WireError('an attribute has no string key');
    const scalar = jsonValue(value);
    if (scalar !== undefined) into[key] = scalar;
  }
  return into;
}
const idOf = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '');
function jsonRequest<T>(body: Json, top: string, scopes: string, records: string, read: (record: Json, base: Attrs) => T | null): T[] {
  return entries(body[top], top).flatMap((r) => {
    const base = jsonAttrs(resourceOf(r.resource).attributes, {});
    return entries(r[scopes], scopes).flatMap((s) => entries(s[records], records).flatMap((record) => read(record, base) ?? []));
  });
}
const jsonSpan = (s: Json, base: Attrs, wanted: (name: string) => boolean): Span | null => {
  const name = typeof s.name === 'string' ? s.name : '';
  if (!wanted(name)) return null;
  return {
    traceId: idOf(s.traceId), spanId: idOf(s.spanId), parentSpanId: idOf(s.parentSpanId), name,
    startMs: jsonMs(s.startTimeUnixNano), endMs: jsonMs(s.endTimeUnixNano), attrs: jsonAttrs(s.attributes, Object.create(base) as Attrs),
  };
};
const jsonLog = (l: Json, base: Attrs): Log => {
  const body = jsonValue(l.body);
  return { timeMs: jsonMs(l.timeUnixNano) || jsonMs(l.observedTimeUnixNano), body: typeof body === 'string' ? body : null, attrs: jsonAttrs(l.attributes, Object.create(base) as Attrs) };
};

export type Encoding = 'protobuf' | 'json';
const parse = (buf: Buffer): Json => {
  try {
    const body: unknown = JSON.parse(buf.toString('utf8'));
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new WireError('the body is not a JSON object');
    return body as Json;
  } catch (error) {
    throw new WireError(`the body is not JSON: ${(error as Error).message}`);
  }
};
/** The spans whose name `wanted` takes, in export order. */
export const readSpans = (buf: Buffer, encoding: Encoding, wanted: (name: string) => boolean): Span[] =>
  encoding === 'protobuf' ? protoRequest(buf, (s, e, base) => protoSpan(buf, s, e, base, wanted)) : jsonRequest(parse(buf), 'resourceSpans', 'scopeSpans', 'spans', (s, base) => jsonSpan(s, base, wanted));
export const readLogs = (buf: Buffer, encoding: Encoding): Log[] =>
  encoding === 'protobuf' ? protoRequest(buf, (s, e, base) => protoLog(buf, s, e, base)) : jsonRequest(parse(buf), 'resourceLogs', 'scopeLogs', 'logRecords', jsonLog);
