#!/usr/bin/env node
// The contract step (#139): every published contract entry with its history, diffed against every earlier release.
//   node scripts/contract-diff.mjs <dump|record|check|notes|old-load|corpus|document <file>> [--release <R>] [--root <tree>]
// A tree holds packages/contracts/ (the published data) and contracts/ (releases/, breaks/, fixtures/, shipped.json,
// corpus.json, corpus-decisions.json). Entries are keyed <kind>:<name>: api (extension-api.json), rpc
// (rpc-methods.json), schema (schemas/: event kinds, document kinds, sidecar formats and every other shape), interface
// (slots/), slot (hub-slots.json rows) and registry (canvas-registries.json). A change against an earlier release is a
// break unless it is additive in a minor or the entry is preview; a break passes only with
// contracts/breaks/<from>_<to>/<issue>.txt quoting each of its diff lines verbatim and a `workaround:` line. Output:
// `PASS contracts: ...`, `FAIL contracts: <entry>: <what> (arrived in <release>)` with `diff: ...` lines under it, or
// `BLOCKED contracts: ...`; exit 0, 1 or 3. DEEP_CONTRACTS_PLANT selects a wrong program a test names.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const PLANTS = ['diff-preview', 'six-kinds-only', 'pass-every-additive', 'any-break-file', 'report-only'];
const plant = process.env.DEEP_CONTRACTS_PLANT || '';
const [command, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i < 0 ? undefined : rest[i + 1]; };
const out = (line) => process.stdout.write(`${line}\n`);
const blocked = (why) => { out(`BLOCKED contracts: ${why}`); process.exit(3); };
if (plant && !PLANTS.includes(plant) && !plant.startsWith('unsupported-shim:')) blocked(`DEEP_CONTRACTS_PLANT=${plant} names no planted program`);
const root = resolve(flag('--root') ?? REPO);
const candidate = flag('--release') ?? 'next';
const at = (...parts) => join(root, ...parts);
const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);
const writeJson = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); };
if (!existsSync(join(REPO, 'packages/contracts/dist/index.js'))) blocked('packages/contracts/dist is not built; run npm run build --workspaces');
const contracts = await import('../packages/contracts/dist/index.js');

// ---- The published entries of a tree, each with its history and its shape.
/** The kinds the planted step covers: only the first six the design lists, which hub slots and registries aren't. */
const covered = (kind) => plant !== 'six-kinds-only' || !['slot', 'registry'].includes(kind);
function entriesOf(base) {
  const data = (name) => join(base, 'packages/contracts', name);
  const entries = {};
  const add = (kind, name, fields, shape) => {
    entries[`${kind}:${name}`] = {
      kind, name, since: fields.since ?? null, stability: fields.stability ?? null, tracking: fields.tracking ?? null,
      deprecated_since: fields.deprecated_since ?? null, replaced_by: fields.replaced_by ?? null, stops_serving: fields.stops_serving ?? null,
      digest: shape === undefined ? null : contracts.d1Digest(shape), shape: shape ?? null,
    };
  };
  for (const e of readJson(data('extension-api.json'), [])) add('api', e.method, e, e.params);
  for (const e of readJson(data('rpc-methods.json'), [])) add('rpc', e.method, e, undefined);
  const schemas = (dir, kind) => {
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const s = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      add(kind, file.slice(0, -5), { since: s['x-since'], stability: s['x-stability'], tracking: s['x-tracking'], deprecated_since: s['x-deprecated_since'], replaced_by: s['x-replaced_by'] }, s);
    }
  };
  schemas(data('schemas'), 'schema');
  schemas(data('slots'), 'interface');
  for (const row of readJson(data('hub-slots.json'), [])) add('slot', `${row.method}${row.variant ? `/${row.variant}` : ''}`, { ...row, stability: row.stability ?? 'stable' }, undefined);
  for (const row of readJson(data('canvas-registries.json'), [])) add('registry', row.registry, row, row.entry);
  return entries;
}
const dumpOf = (base, release) => ({ release, entries: entriesOf(base) });

// ---- The diff of one entry's shape against an earlier one: a list of changes, each { pointer, what, additive, field }.
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const json = (v) => JSON.stringify(v);
// The field a change is in: the last property name on its pointer, past the schema keywords that hold it.
const KEYWORDS = new Set(['properties', 'items', 'oneOf', 'enum', 'type', 'pattern', 'const', 'format', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'additionalProperties', 'propertyNames', '$ref']);
const fieldOf = (pointer) => pointer.split('/').filter((p) => p && !KEYWORDS.has(p) && !/^\d+$/.test(p)).pop() ?? '';
const markOf = (node) => (isObj(node?.['x-closure']) ? node['x-closure'].mark : undefined);
function shapeChanges(before, after, pointer = '') {
  const changes = [];
  const change = (at, what, additive, field = fieldOf(at)) => changes.push({ pointer: at || '/', what, additive, field });
  if (!isObj(before) || !isObj(after)) {
    if (json(before) !== json(after)) change(pointer, `changed from ${json(before)} to ${json(after)}`, false);
    return changes;
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of [...keys].sort()) {
    if (['title', 'description', 'examples', '$comment', 'x-closure', 'x-rules', 'x-since', 'x-stability', 'x-tracking', 'x-deprecated_since', 'x-replaced_by'].includes(key)) continue;
    const b = before[key];
    const a = after[key];
    const here = `${pointer}/${key}`;
    if (key === 'properties' && isObj(b) && isObj(a)) {
      const required = new Set(Array.isArray(after.required) ? after.required : []);
      for (const name of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
        const at = `${here}/${name}`;
        if (!(name in a)) change(at, 'removed', false, name);
        else if (!(name in b)) {
          // A field a reader must act on, such as one that can deny, block, answer or lower a verdict, is never additive.
          const acts = isObj(a[name]) && 'x-acts' in a[name];
          if (required.has(name)) change(at, 'added as a required field', false, name);
          else if (acts && plant !== 'pass-every-additive') change(at, `added in a minor, and a reader must act on it (x-acts: ${a[name]['x-acts']})`, false, name);
          else change(at, 'added as an optional field', true, name);
        } else changes.push(...shapeChanges(b[name], a[name], at));
      }
    } else if (key === 'required') {
      const was = new Set(Array.isArray(b) ? b : []);
      for (const name of (Array.isArray(a) ? a : []).filter((n) => !was.has(n))) {
        if (isObj(before.properties) && name in before.properties) change(`${pointer}/properties/${name}`, 'made required', false, name);
      }
      for (const name of [...was].filter((n) => !(Array.isArray(a) ? a : []).includes(n))) change(`${pointer}/properties/${name}`, 'no longer required', true, name);
    } else if (key === 'enum' && Array.isArray(b) && Array.isArray(a)) {
      const removed = b.filter((v) => !a.includes(v));
      const added = a.filter((v) => !b.includes(v));
      for (const v of removed) change(here, `lost the member ${json(v)}`, false);
      // A member added to a set marked extensible is additive; to an exhaustive set, or one that says neither, a break.
      for (const v of added) change(here, `gained the member ${json(v)} in a${markOf(after) === 'extensible' ? 'n extensible' : markOf(after) === 'exhaustive' ? 'n exhaustive' : ''} set`, markOf(after) === 'extensible');
    } else if (!(key in after)) change(here, 'removed', false);
    else if (!(key in before)) change(here, `added ${json(a)}`, false);
    else changes.push(...shapeChanges(b, a, here));
  }
  return changes;
}

// ---- The history rules on the candidate's entries.
function historyProblems(entries, shipped) {
  const problems = [];
  const calls = new Set((shipped.pieces ?? []).flatMap((p) => p.calls ?? []));
  for (const [key, e] of Object.entries(entries)) {
    if (!covered(e.kind)) continue;
    if (typeof e.since !== 'string' || !e.since) problems.push(`${key}: published without since, the release it arrived in`);
    if (e.stability !== 'stable' && e.stability !== 'preview') problems.push(`${key}: published without stability: stable | preview`);
    if (e.deprecated_since && !e.replaced_by) problems.push(`${key}: deprecated since ${e.deprecated_since} and names nothing as replaced_by`);
    if (e.replaced_by && !entries[`${e.kind}:${e.replaced_by}`]) problems.push(`${key}: replaced_by ${e.replaced_by}, which this release doesn't publish`);
    if (e.stability === 'preview' && !e.tracking) problems.push(`${key}: a preview entry with no tracking issue`);
    // An entry no shipped piece of its release calls is published as preview or not at all.
    if (e.kind === 'api' && e.stability === 'stable' && !calls.has(e.name)) problems.push(`${key}: stable, and no shipped piece of ${candidate} calls it (contracts/shipped.json); publish it as preview`);
  }
  return problems.map((p) => `${p}${arrived(entries, p)}`);
}
const arrived = (entries, problem) => { const e = entries[problem.split(': ')[0]]; return e?.since ? ` (arrived in ${e.since})` : ''; };

// ---- The releases a tree records: contracts/releases/<R>.json, in release order.
const order = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const releasesOf = (base) => (existsSync(join(base, 'contracts/releases')) ? readdirSync(join(base, 'contracts/releases')).filter((f) => /^[^.]+\.json$/.test(f)).map((f) => f.slice(0, -5)).sort(order) : []);

/** A break file's quoted lines and its workaround, or null when it isn't one. */
function breakFile(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const workaround = lines.find((l) => l.startsWith('workaround:'))?.slice('workaround:'.length).trim();
  return { quoted: new Set(lines.filter((l) => l.startsWith('diff: '))), workaround: workaround || null, path };
}
const breakFiles = (from, to) => {
  const dir = at('contracts/breaks', `${from}_${to}`);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.txt')).sort().map((f) => ({ ...breakFile(join(dir, f)), issue: f.slice(0, -4) })) : [];
};

/** Every break of the candidate against one earlier release: { entry, field, what, lines }. */
function breaksAgainst(earlier, entries, from) {
  const found = [];
  for (const [key, was] of Object.entries(earlier.entries)) {
    if (!covered(was.kind)) continue;
    const now = entries[key];
    // A preview entry is outside the break diff, whatever it was or became.
    if (plant !== 'diff-preview' && (was.stability === 'preview' || now?.stability === 'preview')) continue;
    const line = (pointer, what) => `diff: ${from}_${candidate} ${key} ${pointer} ${what}`;
    if (!now) { found.push({ key, entry: was, field: '', what: 'removed', lines: [line('/', 'removed')] }); continue; }
    if (was.digest === now.digest) continue;
    const changes = shapeChanges(was.shape, now.shape);
    const breaks = changes.filter((c) => !c.additive);
    if (!breaks.length) continue;
    found.push({ key, entry: now, field: breaks.map((c) => c.field).filter(Boolean).join(', '), what: breaks.map((c) => `${c.field || c.pointer} ${c.what}`).join('; '), lines: breaks.map((c) => line(c.pointer, c.what)) });
  }
  return found;
}

/** The candidate against every earlier release: the breaks no reviewed break file covers, and the accepted ones. */
function diffAll(entries) {
  const open = [];
  const accepted = [];
  for (const from of releasesOf(root).filter((r) => r !== candidate)) {
    const earlier = readJson(at('contracts/releases', `${from}.json`));
    const files = breakFiles(from, candidate);
    for (const b of breaksAgainst(earlier, entries, from)) {
      const covering = files.find((f) => f.workaround && (plant === 'any-break-file' || b.lines.every((l) => f.quoted.has(l))));
      if (covering) accepted.push({ ...b, from, file: covering });
      else open.push({ ...b, from, files });
    }
  }
  return { open, accepted };
}

function check() {
  const entries = entriesOf(root);
  const shipped = readJson(at('contracts/shipped.json'), { pieces: [] });
  const problems = historyProblems(entries, shipped);
  const { open, accepted } = diffAll(entries);
  for (const p of problems) out(`FAIL contracts: ${p}`);
  for (const b of open) {
    const unquoted = b.files.length ? `; ${b.files.map((f) => relative(root, f.path)).join(', ')} ${b.files.some((f) => !f.workaround) ? 'gives no workaround or ' : ''}quotes none of these lines` : ` with no break file contracts/breaks/${b.from}_${candidate}/<issue>.txt`;
    out(`FAIL contracts: ${b.entry.name}: ${b.what}, a break of ${b.from}_${candidate}${b.field ? ` in the field ${b.field}` : ''}${unquoted} (arrived in ${b.entry.since ?? b.from})`);
    for (const l of b.lines) out(l);
  }
  for (const b of accepted) out(`ACCEPTED contracts: ${b.entry.name}: ${b.from}_${candidate}, reviewed in ${relative(root, b.file.path)}`);
  if (problems.length || open.length) {
    out(`  Fix: give each entry since and stability, a replaced entry its replaced_by and a preview one its tracking issue; a break takes a new major, or a reviewed contracts/breaks/<from>_<to>/<issue>.txt quoting each diff line above and a workaround: line`);
    return 1;
  }
  out(`PASS contracts: ${Object.keys(entries).length} entries of ${candidate} against ${releasesOf(root).filter((r) => r !== candidate).join(', ') || 'no earlier release'}${accepted.length ? `, ${accepted.length} reviewed break${accepted.length > 1 ? 's' : ''}` : ''}`);
  return 0;
}

function notes() {
  const { accepted } = diffAll(entriesOf(root));
  out(`Release notes for ${candidate}: contract changes that break an earlier release`);
  if (!accepted.length) out('  none');
  for (const b of accepted) {
    out(`- ${b.entry.name} (${b.from}_${candidate}, #${b.file.issue}): ${b.what}`);
    for (const l of b.lines) out(`  ${l}`);
    out(`  workaround: ${b.file.workaround}`);
  }
  return 0;
}

// ---- The previous release's fixture: recorded at the release, loaded and called in the candidate (AC4).
const host = () => import('../packages/extension-host/dist/index.js');
/** The stable methods a dump lists, by name. */
const stableMethods = (dump) => Object.values(dump.entries).filter((e) => e.kind === 'api' && e.stability === 'stable').map((e) => e.name).sort();
/** The fixture package's envelope digest: its files, the record written beside them at the release left out. */
async function fixtureDigest(folder) {
  const { packageDigest } = await host();
  const copy = mkdtempSync(join(tmpdir(), 'deep-fixture-'));
  try {
    cpSync(folder, copy, { recursive: true });
    rmSync(join(copy, 'recorded.json'), { force: true });
    return packageDigest(copy);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

/** Runs the fixture in a fresh host on a scratch home: installs, checks and loads it, and reads what its calls returned. */
async function runFixture(folder, api) {
  const { openExtensionHost, openTrust } = await host();
  const { openRecord } = await import('../packages/record/dist/index.js');
  const { openSupervisor } = await import('../packages/supervisor/dist/index.js');
  const { openAsks } = await import('../packages/asks/dist/index.js');
  const scratch = mkdtempSync(join(tmpdir(), 'deep-old-load-'));
  const copy = join(scratch, 'pkg');
  cpSync(folder, copy, { recursive: true });
  rmSync(join(copy, 'recorded.json'), { force: true });
  // The fixture's default export returns its calls' results; a shim the host writes beside it reads them out.
  const record = await openRecord({ path: join(scratch, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const home = join(scratch, 'home');
  mkdirSync(home);
  const { packageDigest } = await host();
  const manifest = JSON.parse(readFileSync(join(copy, 'deepbuild.json'), 'utf8'));
  const release = [{ id: manifest.id, version: manifest.version, digest: packageDigest(copy) }];
  const h = await openExtensionHost({ record, supervisor, asks, trust: await openTrust({ record, now: Date.now }), home, release, now: Date.now, api, ...(plant.startsWith('unsupported-shim:') ? { unsupported: [plant.slice('unsupported-shim:'.length)] } : {}) });
  try {
    await h.ready();
    const pkg = await h.install({ from: copy, builtBy: null });
    const checked = await h.check(pkg);
    if (!checked.passed) return { error: `it failed conformance: ${checked.reasons.join('; ')}` };
    const loaded = await h.load(pkg);
    if (loaded.status !== 'loaded') return { error: loaded.reason };
    return { results: h.loadResult(manifest.id) ?? {} };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  } finally {
    await h.close().catch(() => undefined);
    await supervisor.close().catch(() => undefined);
    await record.close().catch(() => undefined);
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function recordRelease() {
  const dump = dumpOf(root, candidate);
  const fixture = at('contracts/fixtures', candidate);
  if (existsSync(join(fixture, 'deepbuild.json'))) {
    const stable = stableMethods(dump);
    const ran = await runFixture(fixture, Object.values(dump.entries).filter((e) => e.kind === 'api').map(apiOf));
    if (ran.error) { out(`FAIL contracts: ${candidate}'s fixture package didn't load: ${ran.error}`); return 1; }
    // What the fixture called of the release's stable methods, with each result; old-load names a stable method it skipped.
    const results = Object.fromEntries(stable.filter((m) => Object.hasOwn(ran.results, m)).map((m) => [m, ran.results[m] ?? null]));
    dump.fixture = { folder: `contracts/fixtures/${candidate}`, digest: await fixtureDigest(fixture), calls: stable };
    writeJson(join(fixture, 'recorded.json'), { release: candidate, results });
  }
  writeJson(at('contracts/releases', `${candidate}.json`), dump);
  writeJson(at('contracts/releases', `${candidate}.corpus.json`), { release: candidate, failing: corpusRun().filter((m) => m.failure).map((m) => m.name) });
  out(`PASS contracts: recorded ${candidate}: ${Object.keys(dump.entries).length} entries${dump.fixture ? `, its fixture pinned at ${dump.fixture.digest}` : ''}`);
  return 0;
}
/** A dump's API entry, as the host reads the published API. */
const apiOf = (e) => ({ method: e.name, variants: null, since: e.since, stability: e.stability, ...(e.tracking ? { tracking: e.tracking } : {}), digest: e.digest, ...(e.shape ? { params: e.shape } : {}) });

async function oldLoad() {
  const api = JSON.parse(readFileSync(at('packages/contracts/extension-api.json'), 'utf8'));
  let failed = 0;
  const earlier = releasesOf(root).filter((r) => r !== candidate).map((r) => readJson(at('contracts/releases', `${r}.json`))).filter((d) => d.fixture);
  if (!earlier.length) { out(`PASS contracts: no earlier release of ${candidate} shipped a fixture package`); return 0; }
  for (const dump of earlier) {
    const folder = at(dump.fixture.folder);
    const recorded = readJson(join(folder, 'recorded.json'), { results: {} }).results ?? {};
    const digest = existsSync(folder) ? await fixtureDigest(folder) : null;
    // Never rebuilt: the bytes that load are the bytes the release pinned.
    if (digest !== dump.fixture.digest) { out(`FAIL contracts: ${dump.release}'s fixture package: its envelope digest is ${digest}, not ${dump.fixture.digest} that ${dump.release} pinned; it was rebuilt or changed (arrived in ${dump.release})`); failed++; }
    const ran = await runFixture(folder, api);
    if (ran.error) { out(`FAIL contracts: ${dump.release}'s fixture package didn't load in ${candidate}: ${ran.error} (arrived in ${dump.release})`); failed++; continue; }
    for (const method of dump.fixture.calls) {
      const got = ran.results[method];
      const want = recorded[method];
      const since = dump.entries[`api:${method}`]?.since ?? dump.release;
      // Every stable method the release lists is called: a fixture that skips one proves nothing of it.
      if (!Object.hasOwn(recorded, method) || !Object.hasOwn(ran.results, method)) { out(`FAIL contracts: ${method}: ${dump.release} lists it stable, and ${dump.release}'s fixture package never calls it (arrived in ${since})`); failed++; }
      else if (isObj(got) && got.outcome === 'unsupported') { out(`FAIL contracts: ${method}: ${candidate} answers it unsupported to ${dump.release}'s fixture (arrived in ${since})`); failed++; }
      else if (json(got ?? null) !== json(want ?? null)) { out(`FAIL contracts: ${method}: ${dump.release}'s fixture got ${json(got ?? null)}, not ${json(want ?? null)} recorded at ${dump.release} (arrived in ${since})`); failed++; }
      else out(`CALLED contracts: ${method}: equal to ${dump.release}'s record`);
    }
  }
  if (failed) return 1;
  out(`PASS contracts: ${earlier.map((d) => `${d.release}'s fixture called ${d.fixture.calls.length} stable methods`).join('; ')} in ${candidate}`);
  return 0;
}

// ---- The ecosystem corpus (AC8, AC14).
function corpusRun() {
  const members = readJson(at('contracts/corpus.json'), { members: [] }).members ?? [];
  const dir = at('packages/contracts/schemas');
  const schemas = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ name: f.slice(0, -5), schema: JSON.parse(readFileSync(join(dir, f), 'utf8')) })) : [];
  const reg = contracts.registry(schemas);
  return members.map((m) => {
    for (const s of m.samples ?? []) {
      if (!schemas.some((e) => e.name === s.schema)) return { ...m, failure: { schema: s.schema, path: '/', what: `${s.schema} is no longer published` } };
      const held = reg.validate(s.schema, s.value);
      if (!held.ok) { const i = held.issues[0]; return { ...m, failure: { schema: s.schema, path: i.path || '/', what: `${i.code} at ${i.path || '/'} (${i.remediation})` } }; }
    }
    return { ...m, failure: null };
  });
}
function corpus() {
  const runs = corpusRun();
  const previous = releasesOf(root).filter((r) => r !== candidate && existsSync(at('contracts/releases', `${r}.corpus.json`))).pop();
  const known = new Set(previous ? readJson(at('contracts/releases', `${previous}.corpus.json`)).failing : []);
  const decisions = readJson(at('contracts/corpus-decisions.json'), []);
  let held = 0;
  for (const m of runs) {
    if (!m.failure) { out(`OK contracts: corpus ${m.name}`); continue; }
    if (known.has(m.name)) { out(`KNOWN contracts: corpus ${m.name}: already failing in ${previous}: ${m.failure.what}`); continue; }
    const line = `diff: ${previous ?? 'none'}_${candidate} corpus:${m.name} ${m.failure.path} ${m.failure.what}`;
    const decision = decisions.find((d) => d.member === m.name && d.release === candidate);
    // Accepted counts only with its break file quoting this line and a workaround; fixed counts only once it passes, which it doesn't.
    const file = decision?.decision === 'accepted' && decision.break && existsSync(at(decision.break)) ? breakFile(at(decision.break)) : null;
    if (file?.workaround && file.quoted.has(line)) { out(`ACCEPTED contracts: corpus ${m.name}: reviewed in ${decision.break}`); continue; }
    const why = !decision ? 'holds the release until its owner marks it fixed or accepted' : decision.decision === 'fixed' ? 'is marked fixed and still fails, so the release stays held' : 'is marked accepted without a break file that quotes this line and a workaround, so the release stays held';
    out(`FAIL contracts: corpus ${m.name}: a new failure in ${candidate}, ${m.failure.what}; it ${why} (arrived in ${candidate})`);
    out(line);
    held++;
  }
  if (held && plant !== 'report-only') return 1;
  out(`PASS contracts: corpus ${runs.length} members against ${candidate}${known.size ? `, ${[...known].filter((n) => runs.some((m) => m.name === n && m.failure)).length} already failing in ${previous} listed apart` : ''}`);
  return 0;
}

// ---- A document's preview kinds (AC13): each one it uses listed in requires.preview, or it is refused.
function document(file) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const entries = entriesOf(root);
  const listed = new Set(doc.requires?.preview ?? []);
  const unlisted = [...new Set((doc.items ?? []).map((i) => i.kind))].filter((k) => entries[`schema:${k}`]?.stability === 'preview' && !listed.has(k));
  for (const kind of unlisted) out(`FAIL contracts: ${kind}: preview_unrequested, a preview kind the document uses without listing it in requires.preview`);
  if (unlisted.length) return 1;
  out(`PASS contracts: ${file} uses no preview kind it doesn't list`);
  return 0;
}

const commands = {
  dump: () => { out(JSON.stringify(dumpOf(root, candidate), null, 2)); return 0; },
  record: recordRelease, check, notes, 'old-load': oldLoad, corpus, document: () => document(resolve(rest[0] ?? blocked('document takes a file'))),
};
if (!commands[command]) {
  out('Usage: node scripts/contract-diff.mjs <dump|record|check|notes|old-load|corpus|document <file>> [--release <R>] [--root <tree>]');
  process.exit(2);
}
process.exitCode = await commands[command]();
