// #1820 scope: "A document names pack@version, so a re-export uses the same bytes", through the real `deep export
// --document <file> --still <frame> --out <file.png>` (the base's headless still export), never `deep show`.
//
// World: a pack acme/pix lists one tiny PNG (img/dot.png) in two versions with the same path and other bytes (1.0.0 red,
// 1.1.0 blue), served by a local HTTPS server, installed with `deep install` and fetched through `deep_kinds {op:"fetch"}`
// after one authority ask each (the surfaces tests/acceptance/1820/README.md names). The document is an `image@1` item
// whose `asset` is the listed sha256, naming `packs: ["acme/pix@<version>"]`.
// GAP (the surface this implies, as the issue's "a re-export uses the same bytes" needs): `deep export` run with the hub's
// HOME resolves the named pack@version's assets from the hub's store, and an unfetched one it cannot read ends the export
// BLOCKED: exit non-zero, no PNG written, BLOCKED and the asset's path in its output, one `unblock` ask in the record.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLI, NODE, type Ran } from '../../1731/helpers.ts';
import { CC0 } from '../pack.ts';
import { asks, kinds, newAsks, stored, until, yes } from '../helpers.ts';
import { addAsset, installOrBlock, LICENSE_TEXT, scopedWorld, serve, sha, writePack, type Listed, type Scoped } from '../scope/world.ts';

const PACK = 'acme/pix'; const V1 = '1.0.0'; const V2 = '1.1.0';
const AWAY = 'acme/away';
const PATH = 'img/dot.png';

/** A 16x16 solid-colour 8-bit RGB PNG: the smallest real pinned image asset. */
function png(r: number, g: number, b: number): Buffer {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(type), data]); const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), 8 + data.length); return out; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(16, 0); ihdr.writeUInt32BE(16, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 16 }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: 16 }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}
/** The centre pixel of an exported PNG (any 8-bit non-interlaced RGB/RGBA, all five filters). */
function centre(file: Buffer): [number, number, number] {
  expect(file.subarray(0, 8).toString('hex'), 'the export is a PNG').toBe('89504e470d0a1a0a');
  let w = 0, h = 0, ct = 0; const idat: Buffer[] = [];
  for (let p = 8; p < file.length;) {
    const len = file.readUInt32BE(p); const type = file.toString('latin1', p + 4, p + 8); const data = file.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]!; expect(data[8], 'bit depth').toBe(8); expect(data[12], 'interlace').toBe(0); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3; expect([2, 6]).toContain(ct);
  const raw = inflateSync(Buffer.concat(idat)); const stride = w * bpp; const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!; const a = x >= bpp ? px[y * stride + x - bpp]! : 0; const b = y ? px[(y - 1) * stride + x]! : 0; const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp]! : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      px[y * stride + x] = (v + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
  }
  const o = (h >> 1) * stride + (w >> 1) * bpp;
  return [px[o]!, px[o + 1]!, px[o + 2]!];
}

const dot = (version: string, pack = PACK, hash: string): Record<string, unknown> => ({
  format: 1, id: `pix-${version.replace(/\W/g, '')}`, profile: 'figure', title: 'Pack image', description: 'One pinned pack image (#1820).', size: [64, 64], packs: [`${pack}@${version}`],
  layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
  items: { dot: { id: 'dot', kind: 'image@1', layer: 'main', name: 'Dot', order: 'a0', params: { asset: hash, box: [0, 0, 64, 64], fit: 'fill', alt: 'A solid square' } } },
});

let w: Scoped; let off: Awaited<ReturnType<typeof serve>>;
const red: Listed = { path: PATH, body: png(220, 20, 20), license: CC0, licenseText: LICENSE_TEXT.cc0 };
const blue: Listed = { path: PATH, body: png(20, 20, 220), license: CC0, licenseText: LICENSE_TEXT.cc0 };
const away: Listed = { path: PATH, body: png(20, 220, 20), license: CC0, licenseText: LICENSE_TEXT.cc0 };
beforeAll(async () => {
  w = await scopedWorld();
  const tls = { key: readFileSync(join(w.tmp, 'tls', 'leaf.key'), 'utf8'), cert: readFileSync(join(w.tmp, 'tls', 'leaf.pem'), 'utf8') };
  off = await serve(tls);
  addAsset(w.srv, PACK, V1, red, 'v1'); addAsset(w.srv, PACK, V2, blue, 'v2'); addAsset(off, AWAY, V1, away, 'away');
  await installOrBlock(w, writePack(join(w.tmp, 'p1'), w.srv, PACK, V1, [{ a: red, tag: 'v1' }]));
  await installOrBlock(w, writePack(join(w.tmp, 'p2'), w.srv, PACK, V2, [{ a: blue, tag: 'v2' }]));
  await installOrBlock(w, writePack(join(w.tmp, 'p3'), off, AWAY, V1, [{ a: away, tag: 'away' }]));
  await off.close(); // pack acme/away is installed, its asset never fetched, and its network is gone
}, 600_000);

/** The real CLI: `deep export --document <file> --still 0 --out <png>`, in the hub's HOME. */
let n = 0;
function exportStill(document: Record<string, unknown>): Promise<Ran & { out: string; png: Buffer | undefined }> {
  const doc = join(w.tmp, `doc-${n}.json`); const out = join(w.tmp, `still-${n++}.png`);
  writeFileSync(doc, JSON.stringify(document));
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|NODE_OPTIONS|NODE_EXTRA_CA_CERTS)/.test(k)) env[k] = v;
    const child = spawn(NODE, [CLI, 'export', '--document', doc, '--still', '0', '--out', out], { cwd: w.work, env: { ...env, HOME: w.home, XDG_CONFIG_HOME: join(w.home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, out, png: existsSync(out) ? readFileSync(out) : undefined }); });
  });
}
const said = (r: Ran) => `exit ${r.code}: ${r.stdout.slice(-500)} ${r.stderr.slice(-500)}`;
async function fetchOnce(version: string) {
  const args = { op: 'fetch', pack: `${PACK}@${version}`, asset: PATH };
  const before = (await asks(w)).length;
  let o = await kinds(w, args);
  if (o.value.status === 'held') { const r = await newAsks(w, before, 'authority'); expect(r.length, 'one ask').toBe(1); await yes(w, r[0]!); o = await until(w, args); }
  return o;
}

describe('#1820 scope: a document names pack@version, so a re-export uses the same bytes (deep export)', () => {
  it('an export that uses an asset of a pack not fetched, with no network, is BLOCKED with one unblock ask: no PNG, never a pass, repeated without a second ask', async () => {
    const before = (await asks(w)).length;
    const first = await exportStill(dot(V1, AWAY, sha(away.body)));
    const second = await exportStill(dot(V1, AWAY, sha(away.body)));
    for (const r of [first, second]) {
      expect(r.code, `an unfetched asset exported: ${said(r)}`).not.toBe(0);
      expect(r.png, 'a PNG was written without the asset').toBeUndefined();
      expect(`${r.stdout}${r.stderr}`, said(r)).toMatch(/BLOCKED/);
      expect(`${r.stdout}${r.stderr}`, 'names the asset').toContain(PATH);
    }
    const raised = await newAsks(w, before);
    expect(raised.filter((a) => a.kind === 'unblock').length, JSON.stringify(raised.map((a) => a.text))).toBe(1);
    expect(raised.filter((a) => a.kind === 'authority').length, 'a fetch ask while offline').toBe(0);
    expect(await stored(w, sha(away.body))).toBeUndefined();
  }, 600_000);

  it('a document is bound to the version it names: v1 draws its bytes, v2 draws its own, an unnamed version draws nothing', async () => {
    const [o1, o2] = [await fetchOnce(V1), await fetchOnce(V2)];
    expect(o1.value.asset?.sha256, o1.text).toBe(sha(red.body));
    expect(o2.value.asset?.sha256, o2.text).toBe(sha(blue.body));
    const a = await exportStill(dot(V1, PACK, sha(red.body)));
    const b = await exportStill(dot(V2, PACK, sha(blue.body)));
    expect(a.code, said(a)).toBe(0); expect(b.code, said(b)).toBe(0);
    const [ca, cb] = [centre(a.png!), centre(b.png!)];
    expect(ca[0] > 150 && ca[1] < 90 && ca[2] < 90, `1.0.0 draws its red asset: ${ca}`).toBe(true);
    expect(cb[2] > 150 && cb[0] < 90 && cb[1] < 90, `1.1.0 draws its blue asset: ${cb}`).toBe(true);
    const missing = await exportStill(dot('9.9.9', PACK, sha(red.body)));
    expect(missing.code, `${PACK}@9.9.9 was never installed: ${said(missing)}`).not.toBe(0);
    expect(missing.png).toBeUndefined();
  }, 600_000);

  it('a re-export with the upstream changed and the network gone is byte-identical to the first: no request, no ask, no BLOCKED', async () => {
    const first = await exportStill(dot(V1, PACK, sha(red.body)));
    expect(first.code, said(first)).toBe(0);
    w.srv.routes.set(`/${PACK}@${V1}/${PATH}`, { body: png(0, 0, 0) }); // a moving upstream
    const mark = w.srv.log.length; const asksBefore = (await asks(w)).length;
    await w.srv.close();
    const again = await exportStill(dot(V1, PACK, sha(red.body)));
    expect(again.code, said(again)).toBe(0);
    expect(`${again.stdout}${again.stderr}`).not.toMatch(/BLOCKED/);
    expect(again.png!.equals(first.png!), 're-export of pack@version drew different bytes').toBe(true);
    expect(w.srv.since(mark), 'the re-export went to the network').toEqual([]);
    expect((await asks(w)).length, 'a cached re-export asked').toBe(asksBefore);
    expect(await stored(w, sha(red.body))).toBeDefined();
  }, 600_000);
});
