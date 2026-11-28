import { closeSync, openSync, readSync } from 'node:fs';

const IDENT_START = /[A-Za-z_]/;
const IDENT = /[A-Za-z0-9_]/;

export function parse(text) {
  let i = 0;
  const fail = (what) => {
    throw Error(`ron: ${what} at ${i}: ${JSON.stringify(text.slice(Math.max(0, i - 40), i + 40))}`);
  };
  const skip = () => {
    for (;;) {
      const c = text[i];
      if (c === ' ' || c === '\n' || c === '\t' || c === '\r') i++;
      else if (c === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i++;
      } else if (c === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        i = end < 0 ? text.length : end + 2;
      } else return;
    }
  };
  const rawIdent = () => text[i] === 'r' && text[i + 1] === '#' && /[A-Za-z0-9_.+-]/.test(text[i + 2] ?? '');
  const ident = () => {
    const raw = rawIdent();
    if (raw) i += 2;
    const from = i;
    while (i < text.length && (raw ? /[A-Za-z0-9_.+-]/ : IDENT).test(text[i])) i++;
    return text.slice(from, i);
  };
  const string = () => {
    i++;
    let out = '';
    for (;;) {
      const c = text[i++];
      if (c === undefined) fail('an open string');
      if (c === '"') return out;
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = text[i++];
      if (e === 'n') out += '\n';
      else if (e === 't') out += '\t';
      else if (e === 'r') out += '\r';
      else if (e === '0') out += '\0';
      else if (e === 'x') {
        out += String.fromCharCode(parseInt(text.slice(i, i + 2), 16));
        i += 2;
      } else if (e === 'u') {
        const end = text.indexOf('}', i);
        out += String.fromCodePoint(parseInt(text.slice(i + 1, end), 16));
        i = end + 1;
      } else out += e;
    }
  };
  const raw = () => {
    i++;
    let hashes = 0;
    while (text[i] === '#') {
      hashes++;
      i++;
    }
    if (text[i] !== '"') fail('a raw string');
    const close = `"${'#'.repeat(hashes)}`;
    const end = text.indexOf(close, i + 1);
    if (end < 0) fail('an open raw string');
    const out = text.slice(i + 1, end);
    i = end + close.length;
    return out;
  };
  const number = () => {
    const m = /^[+-]?(?:0x[0-9a-fA-F_]+|(?:inf|NaN)|(?:\d[\d_]*)?(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i, i + 64));
    if (!m || m[0] === '' || m[0] === '+' || m[0] === '-') fail('a number');
    i += m[0].length;
    const s = m[0].replaceAll('_', '');
    if (s.endsWith('inf')) return s.startsWith('-') ? -Infinity : Infinity;
    if (s.endsWith('NaN')) return NaN;
    return Number(s);
  };
  const group = () => {
    skip();
    if (text[i] === ')') {
      i++;
      return { fields: null, values: [] };
    }
    const at = i;
    let named = false;
    if (IDENT_START.test(text[i])) {
      ident();
      skip();
      named = text[i] === ':' && text[i + 1] !== ':';
    }
    i = at;
    const fields = named ? {} : null;
    const values = [];
    for (;;) {
      skip();
      if (text[i] === ')') {
        i++;
        return { fields, values };
      }
      if (named) {
        const key = ident();
        skip();
        if (text[i] !== ':') fail('a field');
        i++;
        fields[key] = value();
      } else values.push(value());
      skip();
      if (text[i] === ',') i++;
      else if (text[i] !== ')') fail('a comma or a close');
    }
  };
  function value() {
    skip();
    const c = text[i];
    if (c === undefined) fail('the end');
    if (c === '"') return string();
    if (c === '[') {
      i++;
      const out = [];
      for (;;) {
        skip();
        if (text[i] === ']') {
          i++;
          return out;
        }
        out.push(value());
        skip();
        if (text[i] === ',') i++;
        else if (text[i] !== ']') fail('a comma or a close');
      }
    }
    if (c === '{') {
      i++;
      const out = {};
      for (;;) {
        skip();
        if (text[i] === '}') {
          i++;
          return out;
        }
        const key = value();
        skip();
        if (text[i] !== ':') fail('a map key');
        i++;
        out[typeof key === 'string' ? key : JSON.stringify(key)] = value();
        skip();
        if (text[i] === ',') i++;
        else if (text[i] !== '}') fail('a comma or a close');
      }
    }
    if (c === '(') {
      i++;
      const { fields, values } = group();
      return fields ?? values;
    }
    if (c === "'") {
      const end = text.indexOf("'", i + 2);
      const out = text.slice(i + 1, end);
      i = end + 1;
      return out;
    }
    if (c === 'r' && !rawIdent() && (text[i + 1] === '"' || text[i + 1] === '#')) return raw();
    if (c === '-' || c === '+' || c === '.' || (c >= '0' && c <= '9')) return number();
    if (!IDENT_START.test(c)) fail('a value');
    const name = ident();
    if (name === 'true') return true;
    if (name === 'false') return false;
    if (name === 'None') return null;
    if (name === 'inf' || name === 'NaN') return name === 'inf' ? Infinity : NaN;
    skip();
    if (text[i] !== '(') return name;
    i++;
    const { fields, values } = group();
    if (name === 'Some') return values.length === 1 ? values[0] : (fields ?? values);
    return fields ? { $: name, ...fields } : { $: name, _: values };
  }
  const out = value();
  skip();
  if (text[i] === ',') i++;
  skip();
  if (i < text.length) fail('more after the value');
  return out;
}

export function* actions(path) {
  const fd = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(1 << 24);
  const decoder = new TextDecoder();
  let rest = '';
  let lines = [];
  const flush = function* () {
    if (lines.length) yield lines.join('\n');
    lines = [];
  };
  try {
    for (;;) {
      const n = readSync(fd, buffer, 0, buffer.length, null);
      const text = rest + decoder.decode(buffer.subarray(0, n), { stream: n > 0 });
      const parts = text.split('\n');
      rest = n > 0 ? parts.pop() : '';
      for (const l of parts) {
        if (l === '[' || l === ']' || l === '') continue;
        if (/^[A-Za-z]/.test(l)) yield* flush();
        lines.push(l);
      }
      if (n === 0) break;
    }
    yield* flush();
  } finally {
    closeSync(fd);
  }
}
