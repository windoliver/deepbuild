// Issue 1965's proof: a code-change film as a document, a function quoted from its commit, drawn in each shipped
// look's code roles, and the refusals for a mismatched quote and an unknown token class. Usage:
//   node docs/evidence/1965/shoot.mjs <repo> <outdir>
// It needs `target/debug/deep-canvas-render` (cargo build --locked --bin deep-canvas-render).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [repo, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
// The function this issue's quotes rest on, as main held it when the work began.
const COMMIT = '3962d5281ccf822af55928df2c3c77deeee159f0';
const PATH = 'crates/deep-canvas-marks/src/code.rs';
const source = spawnSync('git', ['show', `${COMMIT}:${PATH}`], { cwd: repo, maxBuffer: 1 << 26 }).stdout;
const sha = createHash('sha256').update(source).digest('hex');
const store = mkdtempSync(join(tmpdir(), 'deep-1965-shoot-'));
writeFileSync(join(store, sha), source);

// The quoted lines, by line number: `pub fn mismatch` to its closing brace. Raw is their bytes, line ends included.
const lines = source.toString('latin1').split(/(?<=\n)/);
const first = lines.findIndex((l) => l.startsWith('pub fn mismatch')) + 1;
const last = first + lines.slice(first).findIndex((l) => l.startsWith('}')) + 1;
const raw = Buffer.from(lines.slice(first - 1, last).join(''), 'latin1');

// The agent's own highlighter, run here: a token is a byte range into raw with a class of the list.
const KEYWORDS = new Set(['pub', 'fn', 'let', 'if', 'return', 'mut', 'usize']);
const tokens = [];
for (const m of raw.toString('latin1').matchAll(/\/\/[^\n]*|"[^"\n]*"|b'[^']*'|\b\d+\b|\b[A-Za-z_][A-Za-z0-9_]*\b|[-+*=<>!&|]+/g)) {
  const [text] = m; const from = m.index; const next = raw[from + text.length];
  const cls = text.startsWith('//') ? 'comment' : /^["b]/.test(text) && /['"]$/.test(text) ? 'string' : /^\d/.test(text) ? 'number'
    : KEYWORDS.has(text) ? 'keyword' : /^[A-Z]/.test(text) ? 'type' : /^[A-Za-z_]/.test(text) ? (next === 0x28 ? 'function' : 'variable') : 'operator';
  tokens.push({ from, to: from + text.length, class: cls });
}

const SIZE = [900, 400];
const film = (raw, tokens) => ({
  format: 1, id: 'code-change-1965', profile: 'figure', title: 'A quoted function', description: 'code.rs\'s mismatch, quoted from its commit.',
  size: SIZE, budget: { class: 'figure' }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
  assets: { source: { sha256: sha, license: { id: 'Apache-2.0', terms: 'This repository\'s license.', shareable: true, credit: 'DeepBuild.' } } },
  items: {
    backdrop: { id: 'backdrop', kind: 'rect@1', name: 'Backdrop', layer: 'main', order: 'a0', params: { box: [0, 0, ...SIZE], paint: { fill: { role: 'ground' } } } },
    fn: { id: 'fn', kind: 'text@1', name: 'mismatch', layer: 'main', order: 'a1', at: { pos: [24, 24, 0] },
      params: { size: 13, code: { language: 'rust', tokens }, raw, quote: { source: sha, path: PATH, lines: [first, last] } } },
  },
});
const bin = join(repo, 'target/debug/deep-canvas-render');
const ask = (command, line) => JSON.parse(spawnSync(bin, [command], { cwd: repo, input: `${JSON.stringify(line)}\n`, encoding: 'utf8', maxBuffer: 1 << 28 }).stdout.split('\n')[0]);
const errors = (a) => (a.issues ?? []).filter((i) => i.severity === 'error').map(({ code, ids, path, actual, what, fix }) => ({ code, ids, path, actual, what, fix }));

const text = raw.toString('utf8');
const record = { commit: COMMIT, path: PATH, lines: [first, last], source_sha256: sha, raw_bytes: raw.length, tokens: tokens.length, looks: {} };
for (const look of ask('look', { list: 'shipped' }).shipped) {
  const checked = ask('check', { doc: film(text, tokens), look, store });
  const drawn = ask('raster', { out: join(out, `quoted-${look}.png`), doc: film(text, tokens), look, store, t: 0 });
  const roles = [...new Set(drawn.texts.fn.glyphs.map((g) => g.role))].sort();
  record.looks[look] = { check_ok: checked.ok, errors: errors(checked), quotation: checked.numbers.filter((n) => n.source?.quotation).length, drawn: drawn.ok, roles };
}
// The refusals: one byte of the quote changed, and a token class outside the list.
const changed = text.replace('saturating_sub', 'saturating_add');
record.mismatched_quote = errors(ask('check', { doc: film(changed, tokens), look: 'clean', store }));
record.unknown_class = errors(ask('check', { doc: film(text, [{ ...tokens[0], class: 'identifier' }, ...tokens.slice(1)]), look: 'clean', store }));
writeFileSync(join(out, 'proof.json'), `${JSON.stringify(record, null, 2)}\n`);
rmSync(store, { recursive: true, force: true });
console.log(JSON.stringify({ lines: record.lines, tokens: record.tokens, looks: Object.fromEntries(Object.entries(record.looks).map(([k, v]) => [k, `${v.check_ok}/${v.drawn}`])), mismatch: record.mismatched_quote.map((e) => e.code), unknown: record.unknown_class.map((e) => e.path) }));
