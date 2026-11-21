// The independent reader (#732's criteria: "a pinned Office Open XML reader that is not the writer's library"): this
// suite's own small reader of a pptx package, written here from the Office Open XML parts it reads, with nothing of the
// writer's code or library in it. Node has no XML parser and no Office Open XML library is installed, so it holds a zip
// reader and writer (Node's zlib inflates a deflated entry; the writer stores entries), an XML parser that resolves
// namespaces and keeps each element's place in its source, and the deck model the tests judge: the slide size, the
// slides in presentation order, each slide's shapes in z-order (text boxes with their runs, pictures, other editable
// shapes, each with every colour it carries), each slide's speaker notes, and the embedded fonts. Two edits are made
// through it: a deck holding one of its slides (what LibreOffice renders) and a slide whose text box says another string
// (criterion 7). README: The independent reader.
//
// What it reads, and leaves out (README: readings): a text box is a `p:sp` with text and its own `a:xfrm`; a run's
// size, bold, italic, family and colour are its own `a:rPr`'s, else its text body's level defaults (`a:lstStyle`), else
// the master's `p:otherStyle`, else the presentation's `p:defaultTextStyle`; a placeholder's inheritance from layouts is
// not read. Colours are `a:srgbClr`, `a:schemeClr` (through the master's colour map and the theme), `a:sysClr`'s
// `lastClr` and `a:scrgbClr`; a colour with a modifier other than `a:alpha` reads as unknown.

import { crc32, inflateRawSync } from 'node:zlib';

// ---------------------------------------------------------------------------------------------------
// Zip

/** A package's parts by name, in the order the archive holds them. */
export type Parts = Map<string, Buffer>;

/** Every entry of a zip archive (stored or deflated), each checked against its CRC-32. */
export function unzip(buf: Buffer): Parts {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw Error('not a zip archive: no end of central directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw Error('a zip64 archive, which this reader does not read');
  const parts: Parts = new Map();
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw Error(`zip: central directory entry ${k} is malformed`);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw Error(`zip: ${name}'s local header is malformed`);
    const at = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(at, at + csize);
    const bytes = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null;
    if (!bytes) throw Error(`zip: ${name} uses compression method ${method}`);
    if (bytes.length !== usize || crc32(bytes) >>> 0 !== crc) throw Error(`zip: ${name} doesn't match its size or CRC-32`);
    parts.set(name, bytes);
  }
  return parts;
}

/** A zip archive of `parts`, each stored, at the format's first date. */
export function zip(parts: Parts): Buffer {
  const out: Buffer[] = []; const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of parts) {
    const n = Buffer.from(name, 'utf8');
    const crc = crc32(data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(0, 8);
    head.writeUInt16LE(0, 10); head.writeUInt16LE(0x21, 12); head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22); head.writeUInt16LE(n.length, 26); head.writeUInt16LE(0, 28);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(0, 12); dir.writeUInt16LE(0x21, 14); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(n.length, 28); dir.writeUInt32LE(offset, 42);
    out.push(head, n, data); central.push(dir, n);
    offset += 30 + n.length + data.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.size, 8); end.writeUInt16LE(parts.size, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...out, ...central, end]);
}

// ---------------------------------------------------------------------------------------------------
// XML: elements with their namespace, attributes, direct text and place in the source.

export interface XNode {
  /** The name as written (`p:sp`), its namespace URI and its local name. */
  name: string; ns: string; local: string;
  attrs: Record<string, string>;
  nsmap: Record<string, string>;
  children: XNode[];
  /** Its own text (decoded), not its children's. */
  text: string;
  /** Where it is in the source: the whole element, and its content. */
  start: number; end: number; inner: [number, number]; selfClosing: boolean;
}

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s: string): string => s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) =>
  e.startsWith('#x') ? String.fromCodePoint(parseInt(e.slice(2), 16)) : e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1))) : ENTITY[e]!);
/** Text as XML content. */
export const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The root element of an XML document; malformed nesting throws, naming the tags. */
export function parseXml(src: string): XNode {
  let root: XNode | null = null;
  const stack: XNode[] = [];
  for (const m of src.matchAll(TOKEN)) {
    const at = m.index;
    if (m[3] !== undefined) {
      const parent = stack[stack.length - 1] ?? null;
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!] = decode(a[2] ?? a[3] ?? '');
      const nsmap = { ...(parent?.nsmap ?? {}) };
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'xmlns') nsmap[''] = v;
        else if (k.startsWith('xmlns:')) nsmap[k.slice(6)] = v;
      }
      const colon = m[3].indexOf(':');
      const prefix = colon < 0 ? '' : m[3].slice(0, colon);
      const end = at + m[0].length;
      const node: XNode = {
        name: m[3], ns: nsmap[prefix] ?? '', local: colon < 0 ? m[3] : m[3].slice(colon + 1), attrs, nsmap, children: [], text: '',
        start: at, end, inner: [end, end], selfClosing: m[5] === '/',
      };
      if (parent) parent.children.push(node);
      else root ??= node;
      if (!node.selfClosing) stack.push(node);
    } else if (m[2] !== undefined) {
      const node = stack.pop();
      if (!node || node.name !== m[2]) throw Error(`XML: </${m[2]}> closes <${node?.name ?? 'nothing'}>`);
      node.inner = [node.inner[0], at];
      node.end = at + m[0].length;
    } else if (m[1] !== undefined || m[6] !== undefined) {
      const top = stack[stack.length - 1];
      if (top) top.text += m[1] ?? decode(m[6]!);
    }
  }
  if (!root || stack.length) throw Error(`XML: ${root ? `<${stack[stack.length - 1]!.name}> is never closed` : 'no root element'}`);
  return root;
}

export const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
} as const;
const is = (n: XNode, ns: string, local: string): boolean => n.ns === ns && n.local === local;
/** The children of `n` named `local` in `ns`. */
export const kids = (n: XNode | undefined, ns: string, local: string): XNode[] => (n ? n.children.filter((c) => is(c, ns, local)) : []);
export const kid = (n: XNode | undefined, ns: string, local: string): XNode | undefined => kids(n, ns, local)[0];
/** Every element under `n`, depth first, in document order. */
export function descendants(n: XNode): XNode[] {
  const out: XNode[] = [];
  const walk = (x: XNode): void => { for (const c of x.children) { out.push(c); walk(c); } };
  walk(n);
  return out;
}
/** An attribute by its local name, unprefixed, or in namespace `ns`. */
export function attr(n: XNode | undefined, local: string, ns = ''): string | undefined {
  if (!n) return undefined;
  for (const [q, v] of Object.entries(n.attrs)) {
    const colon = q.indexOf(':');
    if (ns === '' ? q === local : colon > 0 && q.slice(colon + 1) === local && n.nsmap[q.slice(0, colon)] === ns) return v;
  }
  return undefined;
}
const numAttr = (n: XNode | undefined, local: string): number | null => {
  const v = attr(n, local);
  return v === undefined || !/^-?\d+$/.test(v) ? null : Number(v);
};

// ---------------------------------------------------------------------------------------------------
// Packages: relationships

/** A part's relationships: ID → {type, target part name (or external target)}. */
export function relsOf(parts: Parts, part: string): Map<string, { type: string; target: string; external: boolean }> {
  const slash = part.lastIndexOf('/');
  const dir = slash < 0 ? '' : part.slice(0, slash);
  const relsPart = `${dir ? `${dir}/` : ''}_rels/${part.slice(slash + 1)}.rels`;
  const out = new Map<string, { type: string; target: string; external: boolean }>();
  const bytes = parts.get(relsPart);
  if (!bytes) return out;
  for (const r of kids(parseXml(bytes.toString('utf8')), NS.rel, 'Relationship')) {
    const id = attr(r, 'Id'); const type = attr(r, 'Type') ?? ''; const target = attr(r, 'Target') ?? '';
    if (!id) continue;
    const external = attr(r, 'TargetMode') === 'External';
    out.set(id, { type, target: external ? target : resolvePart(dir, target), external });
  }
  return out;
}
function resolvePart(dir: string, target: string): string {
  const segs = target.startsWith('/') ? [] : dir.split('/').filter(Boolean);
  for (const s of decodeURI(target).split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') segs.pop(); else segs.push(s);
  }
  return segs.join('/');
}
const relOfType = (rels: ReturnType<typeof relsOf>, suffix: string): string | undefined =>
  [...rels.values()].find((r) => !r.external && r.type.endsWith(`/${suffix}`))?.target;

// ---------------------------------------------------------------------------------------------------
// The deck model

/** One run of a text box, its properties resolved (README: readings). Sizes in points; colours `#rrggbb`. */
export interface Run { text: string; size: number | null; bold: boolean; italic: boolean; family: string | null; color: string | null }
/** One element of a slide's shape tree, in z-order. Boxes are in EMU on the slide, after any group's transform. */
export interface Shape {
  /** `text`: a `p:sp` with text; `picture`: a `p:pic`, a `p:sp` filled with a picture and no text, or the slide's
   * background filled with a picture (first, under every shape); `shape`: any other editable shape (`p:sp`, `p:cxnSp`,
   * `p:graphicFrame`). */
  kind: 'text' | 'picture' | 'shape';
  name: string;
  box: [number, number, number, number] | null;
  /** Its text, paragraphs joined by a line feed. */
  text: string;
  runs: Run[];
  /** Every colour anywhere in it that resolves, `#rrggbb`. */
  colors: string[];
  node: XNode;
}
export interface Slide { n: number; part: string; shapes: Shape[]; notes: string | null }
export interface EmbeddedFont { typeface: string; parts: string[] }
export interface Deck {
  parts: Parts;
  /** The presentation part and its slide list (`p:sldId` elements, in order). */
  presentation: { part: string; xml: string; slideIds: XNode[] };
  /** `p:sldSz`, EMU. */
  size: [number, number];
  slides: Slide[];
  fonts: EmbeddedFont[];
}

interface Theme { colors: Record<string, string>; major: string | null; minor: string | null }
interface Ctx { theme: Theme; clrMap: Record<string, string>; styles: XNode[] }

const hex = (v: string | undefined): string | null => (v && /^[0-9a-fA-F]{6}$/.test(v) ? `#${v.toLowerCase()}` : null);
function themeOf(xml: Buffer | undefined): Theme {
  const theme: Theme = { colors: {}, major: null, minor: null };
  if (!xml) return theme;
  const root = parseXml(xml.toString('utf8'));
  const elements = kid(root, NS.a, 'themeElements');
  for (const c of kid(elements, NS.a, 'clrScheme')?.children ?? []) {
    const v = c.children[0];
    const h = v ? (is(v, NS.a, 'srgbClr') ? hex(attr(v, 'val')) : is(v, NS.a, 'sysClr') ? hex(attr(v, 'lastClr')) : null) : null;
    if (h) theme.colors[c.local] = h;
  }
  const fonts = kid(elements, NS.a, 'fontScheme');
  theme.major = attr(kid(kid(fonts, NS.a, 'majorFont'), NS.a, 'latin'), 'typeface') ?? null;
  theme.minor = attr(kid(kid(fonts, NS.a, 'minorFont'), NS.a, 'latin'), 'typeface') ?? null;
  return theme;
}

const COLOR = new Set(['srgbClr', 'schemeClr', 'sysClr', 'scrgbClr', 'prstClr', 'hslClr']);
const PRESET: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff' };
const encode = (linear: number): number => {
  const c = Math.min(1, Math.max(0, linear));
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
};
/** A colour element as `#rrggbb`, or null when it can't be resolved here. */
function colorOf(c: XNode, ctx: Ctx): string | null {
  if (c.children.some((m) => m.ns === NS.a && m.local !== 'alpha')) return null;
  switch (c.local) {
    case 'srgbClr': return hex(attr(c, 'val'));
    case 'sysClr': return hex(attr(c, 'lastClr'));
    case 'prstClr': return PRESET[attr(c, 'val') ?? ''] ?? null;
    case 'scrgbClr': {
      const v = ['r', 'g', 'b'].map((k) => numAttr(c, k));
      return v.some((x) => x === null) ? null : `#${v.map((x) => encode(x! / 100_000).toString(16).padStart(2, '0')).join('')}`;
    }
    case 'schemeClr': {
      const val = attr(c, 'val') ?? '';
      return ctx.theme.colors[ctx.clrMap[val] ?? val] ?? null;
    }
    default: return null;
  }
}
/** Every colour element under `n` that resolves. */
const colorsUnder = (n: XNode, ctx: Ctx): string[] =>
  descendants(n).filter((c) => c.ns === NS.a && COLOR.has(c.local)).map((c) => colorOf(c, ctx)).filter((c): c is string => c !== null);

/** A text body's runs, its properties through the cascade (README: readings). */
function runsOf(body: XNode, ctx: Ctx): { runs: Run[]; text: string } {
  const runs: Run[] = []; const paras: string[] = [];
  const lst = kid(body, NS.a, 'lstStyle');
  for (const p of kids(body, NS.a, 'p')) {
    const lvl = Number(attr(kid(p, NS.a, 'pPr'), 'lvl') ?? '0') + 1;
    const levels = (style: XNode | undefined): (XNode | undefined)[] =>
      [kid(kid(style, NS.a, 'defPPr'), NS.a, 'defRPr'), kid(kid(style, NS.a, `lvl${lvl}pPr`), NS.a, 'defRPr')];
    const inherited = [...ctx.styles.flatMap(levels), ...levels(lst)];
    let text = '';
    for (const r of p.children) {
      if (r.ns !== NS.a) continue;
      if (r.local === 'br') { text += '\n'; continue; }
      if (r.local !== 'r' && r.local !== 'fld') continue;
      const t = kids(r, NS.a, 't').map((x) => x.text).join('');
      const run: Run = { text: t, size: null, bold: false, italic: false, family: null, color: null };
      for (const props of [...inherited, kid(r, NS.a, 'rPr')]) {
        if (!props) continue;
        const sz = numAttr(props, 'sz');
        if (sz !== null) run.size = sz / 100;
        const b = attr(props, 'b'); if (b !== undefined) run.bold = b === '1' || b === 'true';
        const i = attr(props, 'i'); if (i !== undefined) run.italic = i === '1' || i === 'true';
        const face = attr(kid(props, NS.a, 'latin'), 'typeface');
        if (face) run.family = face === '+mn-lt' ? ctx.theme.minor : face === '+mj-lt' ? ctx.theme.major : face;
        const fill = kid(props, NS.a, 'solidFill');
        if (fill) run.color = fill.children[0] ? colorOf(fill.children[0], ctx) : null;
        if (kid(props, NS.a, 'noFill')) run.color = null;
      }
      runs.push(run);
      text += t;
    }
    paras.push(text);
  }
  return { runs, text: paras.join('\n') };
}

type Map2 = (b: [number, number, number, number]) => [number, number, number, number];
const xfrmBox = (x: XNode | undefined): [number, number, number, number] | null => {
  const off = kid(x, NS.a, 'off'); const ext = kid(x, NS.a, 'ext');
  const v = [numAttr(off, 'x'), numAttr(off, 'y'), numAttr(ext, 'cx'), numAttr(ext, 'cy')];
  return v.some((n) => n === null) ? null : (v as [number, number, number, number]);
};
/** The shapes of a shape tree, groups flattened through their transforms, in z-order. */
function shapesOf(tree: XNode, ctx: Ctx, map: Map2, out: Shape[]): Shape[] {
  for (const c of tree.children) {
    if (is(c, NS.mc, 'AlternateContent')) { const pick = kid(c, NS.mc, 'Choice') ?? kid(c, NS.mc, 'Fallback'); if (pick) shapesOf(pick, ctx, map, out); continue; }
    if (c.ns !== NS.p) continue;
    const nv = c.children.find((x) => x.ns === NS.p && x.local.startsWith('nv'));
    const name = attr(kid(nv, NS.p, 'cNvPr'), 'name') ?? '';
    const spPr = kid(c, NS.p, 'spPr');
    const placed = (b: [number, number, number, number] | null): [number, number, number, number] | null => (b ? map(b) : null);
    if (c.local === 'grpSp') {
      const x = kid(kid(c, NS.p, 'grpSpPr'), NS.a, 'xfrm');
      const own = xfrmBox(x);
      const chOff = kid(x, NS.a, 'chOff'); const chExt = kid(x, NS.a, 'chExt');
      const ch = [numAttr(chOff, 'x'), numAttr(chOff, 'y'), numAttr(chExt, 'cx'), numAttr(chExt, 'cy')];
      const inner: Map2 = own && ch.every((v) => v !== null) && ch[2] && ch[3]
        ? ([bx, by, bw, bh]) => {
          const [cx, cy, cw, chh] = ch as number[];
          const sx = own[2] / cw!; const sy = own[3] / chh!;
          return map([own[0] + (bx - cx!) * sx, own[1] + (by - cy!) * sy, bw * sx, bh * sy]);
        }
        : map;
      shapesOf(c, ctx, inner, out);
    } else if (c.local === 'sp') {
      const body = kid(c, NS.p, 'txBody');
      const { runs, text } = body ? runsOf(body, ctx) : { runs: [], text: '' };
      const kind = text !== '' ? 'text' : kid(spPr, NS.a, 'blipFill') ? 'picture' : 'shape';
      out.push({ kind, name, box: placed(xfrmBox(kid(spPr, NS.a, 'xfrm'))), text, runs, colors: colorsUnder(c, ctx), node: c });
    } else if (c.local === 'pic') {
      out.push({ kind: 'picture', name, box: placed(xfrmBox(kid(spPr, NS.a, 'xfrm'))), text: '', runs: [], colors: colorsUnder(c, ctx), node: c });
    } else if (c.local === 'cxnSp' || c.local === 'graphicFrame') {
      const x = c.local === 'cxnSp' ? kid(spPr, NS.a, 'xfrm') : kid(c, NS.p, 'xfrm');
      out.push({ kind: 'shape', name, box: placed(xfrmBox(x)), text: '', runs: [], colors: colorsUnder(c, ctx), node: c });
    }
  }
  return out;
}

/** The text of a notes slide's body placeholders (or, with none, of its shapes other than the slide image, number,
 * header, footer and date). */
function notesText(xml: Buffer): string {
  const root = parseXml(xml.toString('utf8'));
  const tree = kid(kid(root, NS.p, 'cSld'), NS.p, 'spTree');
  const shapes = kids(tree, NS.p, 'sp').map((s) => {
    const ph = kid(kid(kid(s, NS.p, 'nvSpPr'), NS.p, 'nvPr'), NS.p, 'ph');
    const body = kid(s, NS.p, 'txBody');
    const text = body ? kids(body, NS.a, 'p').map((p) => descendants(p).filter((t) => is(t, NS.a, 't')).map((t) => t.text).join('')).join('\n') : '';
    return { type: ph ? attr(ph, 'type') ?? 'body' : null, text };
  });
  const bodies = shapes.filter((s) => s.type === 'body');
  return (bodies.length ? bodies : shapes.filter((s) => !['sldImg', 'sldNum', 'hdr', 'ftr', 'dt'].includes(s.type ?? ''))).map((s) => s.text).join('\n');
}

/** A pptx file read: its slides, shapes, notes and fonts. A package it can't read throws, saying why. */
export function readDeck(bytes: Buffer): Deck {
  const parts = unzip(bytes);
  const root = relOfType(relsOf(parts, ''), 'officeDocument');
  const presPart = root && parts.has(root) ? root : 'ppt/presentation.xml';
  const presBytes = parts.get(presPart);
  if (!presBytes) throw Error(`the package has no presentation part (${presPart})`);
  const presXml = presBytes.toString('utf8');
  const pres = parseXml(presXml);
  const presRels = relsOf(parts, presPart);
  const sz = kid(pres, NS.p, 'sldSz');
  const size: [number, number] = [numAttr(sz, 'cx') ?? 0, numAttr(sz, 'cy') ?? 0];
  const defaults = kid(pres, NS.p, 'defaultTextStyle');
  const slideIds = kids(kid(pres, NS.p, 'sldIdLst'), NS.p, 'sldId');
  const slides = slideIds.map((s, i): Slide => {
    const part = presRels.get(attr(s, 'id', NS.r) ?? '')?.target ?? '';
    const xml = parts.get(part);
    if (!xml) throw Error(`slide ${i + 1}'s part ${part || '(no relationship)'} isn't in the package`);
    const rels = relsOf(parts, part);
    const layout = relOfType(rels, 'slideLayout');
    const master = layout ? relOfType(relsOf(parts, layout), 'slideMaster') : undefined;
    const masterXml = master ? parts.get(master) : undefined;
    const masterRoot = masterXml ? parseXml(masterXml.toString('utf8')) : undefined;
    const clrMap: Record<string, string> = { ...(kid(masterRoot, NS.p, 'clrMap')?.attrs ?? { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }) };
    const theme = themeOf(master ? parts.get(relOfType(relsOf(parts, master), 'theme') ?? '') : undefined);
    const other = kid(kid(masterRoot, NS.p, 'txStyles'), NS.p, 'otherStyle');
    const ctx: Ctx = { theme, clrMap, styles: [defaults, other].filter((x): x is XNode => x !== undefined) };
    const cSld = kid(parseXml(xml.toString('utf8')), NS.p, 'cSld');
    const tree = kid(cSld, NS.p, 'spTree');
    const notesPart = relOfType(rels, 'notesSlide');
    const notes = notesPart && parts.get(notesPart) ? notesText(parts.get(notesPart)!) : null;
    // A background filled with a picture is a picture under every shape.
    const bg = kid(kid(cSld, NS.p, 'bg'), NS.p, 'bgPr');
    const under: Shape[] = bg && kid(bg, NS.a, 'blipFill')
      ? [{ kind: 'picture', name: 'background', box: [0, 0, size[0], size[1]], text: '', runs: [], colors: colorsUnder(bg, ctx), node: bg }]
      : [];
    return { n: i + 1, part, shapes: [...under, ...(tree ? shapesOf(tree, ctx, (b) => b, []) : [])], notes };
  });
  const fonts = kids(kid(pres, NS.p, 'embeddedFontLst'), NS.p, 'embeddedFont').map((f) => ({
    typeface: attr(kid(f, NS.p, 'font'), 'typeface') ?? '',
    parts: f.children.filter((c) => c.ns === NS.p && c.local !== 'font').map((c) => presRels.get(attr(c, 'id', NS.r) ?? '')?.target ?? '').filter(Boolean),
  }));
  return { parts, presentation: { part: presPart, xml: presXml, slideIds }, size, slides, fonts };
}

/** Every part that holds font data: under `ppt/fonts/`, with a font file's extension, or a font content type. */
export function fontParts(deck: Deck): string[] {
  const ct = deck.parts.get('[Content_Types].xml');
  const types = new Map<string, string>(); const defaults = new Map<string, string>();
  if (ct) {
    const root = parseXml(ct.toString('utf8'));
    for (const o of kids(root, NS.ct, 'Override')) types.set((attr(o, 'PartName') ?? '').replace(/^\//, ''), attr(o, 'ContentType') ?? '');
    for (const d of kids(root, NS.ct, 'Default')) defaults.set((attr(d, 'Extension') ?? '').toLowerCase(), attr(d, 'ContentType') ?? '');
  }
  return [...deck.parts.keys()].filter((p) => {
    const ext = p.split('.').pop()!.toLowerCase();
    const type = types.get(p) ?? defaults.get(ext) ?? '';
    return p.startsWith('ppt/fonts/') || ['fntdata', 'ttf', 'otf', 'odttf', 'eot', 'woff', 'woff2'].includes(ext) || /font/i.test(type);
  });
}

// ---------------------------------------------------------------------------------------------------
// Edits

/** `src` with each range [from, to) replaced, ranges not overlapping. */
function splice(src: string, edits: [number, number, string][]): string {
  let out = src;
  for (const [from, to, text] of [...edits].sort((x, y) => y[0] - x[0])) out = out.slice(0, from) + text + out.slice(to);
  return out;
}
/** The deck's package with its presentation listing only slide `n` (1-based): what LibreOffice renders as that slide. */
export function onlySlide(deck: Deck, n: number): Buffer {
  const { part, xml, slideIds } = deck.presentation;
  if (!slideIds[n - 1]) throw Error(`the deck has no slide ${n}`);
  const parts: Parts = new Map(deck.parts);
  parts.set(part, Buffer.from(splice(xml, slideIds.filter((_, i) => i !== n - 1).map((s) => [s.start, s.end, ''])), 'utf8'));
  return zip(parts);
}
/** The deck's package with slide `n`'s one text box whose text is `from` saying `to` instead: the first `a:t` of its
 * runs holds `to`, the others nothing, every property as it was. */
export function withText(deck: Deck, n: number, from: string, to: string): Buffer {
  const slide = deck.slides[n - 1];
  if (!slide) throw Error(`the deck has no slide ${n}`);
  const boxes = slide.shapes.filter((s) => s.kind === 'text' && s.text === from);
  if (boxes.length !== 1) throw Error(`slide ${n} has ${boxes.length} text boxes saying ${JSON.stringify(from)}, not one`);
  const xml = deck.parts.get(slide.part)!.toString('utf8');
  const ts = descendants(boxes[0]!.node).filter((t) => is(t, NS.a, 't'));
  const edits = ts.map((t, i): [number, number, string] => {
    const text = i === 0 ? escapeXml(to) : '';
    return t.selfClosing ? [t.start, t.end, `<${t.name}>${text}</${t.name}>`] : [t.inner[0], t.inner[1], text];
  });
  const parts: Parts = new Map(deck.parts);
  parts.set(slide.part, Buffer.from(splice(xml, edits), 'utf8'));
  return zip(parts);
}
