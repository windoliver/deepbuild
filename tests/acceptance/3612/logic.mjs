// How the #3612 acceptance tests drive the logic module (README: The surface under test): `deep-logic`, which reads
// JSON lines and writes one reply a line, given the release's packs as the canvas core gives them to the module's
// pack check (crates/deep-show/src/sandbox.rs `vet_libs`), each fixture's piece as that check makes it
// (crates/deep-logic/src/fixtures.rs `run_fixtures`, interfaces.rs `fixture_call`), and the count of piece checks
// (README: The count). The judges at the end decide each criterion from what the binary answered and nothing else;
// record.mjs and the tests read the binary through the same functions.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, binary, blocked, brief, isObject, open, same } from './common.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const list = (v) => (Array.isArray(v) ? v : []);

// ---------------------------------------------------------------------------------------------------
// The release's packs: every folder of packs/ that holds a pack.json (packages/hub/src/packs.ts `releasePacks`).

/** Each shipped pack, in the hub's order: its folder, the ID the hub reads it as (`deepbuild/<name>`) and its pack.json. */
export function shippedPacks() {
  const root = join(REPO, 'packs');
  return readdirSync(root).sort().filter((folder) => existsSync(join(root, folder, 'pack.json'))).map((folder) => {
    const manifest = JSON.parse(readFileSync(join(root, folder, 'pack.json'), 'utf8'));
    return { folder, dir: join(root, folder), id: `deepbuild/${manifest.name}`, manifest };
  });
}

/**
 * The shipped packs the logic module checks (those with `libs` or `interfaces`), each as the canvas core hands it to
 * `pack_check`: `pack` (its name, version, origin `first_party`, libs and interfaces), `assets` (every asset its
 * pack.json lists, by SHA-256, in base64) and `paths` (each asset's file in the pack, for a message).
 */
export function logicPacks() {
  return shippedPacks().filter(({ manifest }) => manifest.libs !== undefined || manifest.interfaces !== undefined).map(({ folder, dir, manifest }) => {
    const assets = {}, paths = {};
    for (const asset of list(manifest.assets)) {
      const bytes = readFileSync(join(dir, asset.path));
      if (sha256(bytes) !== asset.sha256) throw blocked(`packs/${folder}/${asset.path} doesn't hash to the SHA-256 its pack.json lists`);
      assets[asset.sha256] = bytes.toString('base64');
      paths[asset.sha256] = `packs/${folder}/${asset.path}`;
    }
    const pack = { name: manifest.name, version: manifest.version, origin: 'first_party', libs: manifest.libs ?? {}, interfaces: manifest.interfaces ?? {} };
    return { folder, manifest, pack, assets, paths };
  });
}

/** A fixture as a message names it: its hash and its file in the pack. */
export const named = (lp, sha) => `${sha} (${lp.paths[sha] ?? 'no asset of the pack'})`;

// ---------------------------------------------------------------------------------------------------
// `deep-logic`

/** Starts `deep-logic`, with `--planted <name>` for each planted runner; BLOCKED when there is no binary. */
export function openLogic(planted = []) {
  return open(binary('deep-logic'), planted.flatMap((name) => ['--planted', name]), ['deep-logic', ...planted.map((name) => `--planted ${name}`)].join(' '));
}

/** README, The count: `{"call": "piece_checks"}` answers `{"ok": true, "piece_checks": n}`. The reply, and `n` or null where it gives none. */
export async function pieceChecks(logic) {
  const reply = await logic.send({ call: 'piece_checks' }, 'piece_checks');
  const n = reply.piece_checks;
  return { reply, count: reply.ok === true && Number.isSafeInteger(n) && n >= 0 ? n : null };
}

/** The logic module's check of a pack, as the canvas core asks for it. */
export const packCheck = (logic, lp) => logic.send({ call: 'pack_check', pack: lp.pack, assets: lp.assets }, `the check of ${lp.folder}`);

// ---------------------------------------------------------------------------------------------------
// The pieces a pack's check makes, read from its own reply.

/**
 * Every piece the check of `lp` made, from its reply: one for each fixture it ran on a library (a record with `ran`),
 * one for each fixture it ran on a planted library (each of the interface's fixtures up to the one `judged` says the
 * library failed), and one for each kit twin. BLOCKED when the reply doesn't say.
 */
export function piecesOf(lp, reply) {
  if (reply.ok !== true || !Array.isArray(reply.libraries) || !Array.isArray(reply.interfaces)) throw blocked(`the check of ${lp.folder} lists no libraries and interfaces: ${brief(reply)}`);
  const pieces = [];
  for (const row of reply.interfaces) {
    const declared = lp.pack.interfaces[row.label ?? row.name];
    if (!isObject(declared)) throw blocked(`the check of ${lp.folder} lists an interface its pack.json doesn't declare: ${brief(row, 200)}`);
    for (const judged of list(row.judged)) {
      const failed = list(declared.fixtures).indexOf(judged.fails);
      if (failed < 0) throw blocked(`the check of ${lp.folder} doesn't say which of ${row.name}'s fixtures its planted library ${judged.planted} failed (${brief(judged.fails)}), so the fixtures it ran can't be counted`);
      for (const fixture of declared.fixtures.slice(0, failed + 1)) pieces.push({ kind: 'fixture', on: judged.planted, interface: row.name, fixture });
    }
    for (const twin of list(row.kit)) pieces.push({ kind: 'twin', on: twin.planted, interface: row.name, fixture: twin.example });
  }
  for (const library of reply.libraries) {
    for (const implemented of list(library.interfaces)) {
      for (const record of list(implemented.fixtures)) if (record.ran === true) pieces.push({ kind: 'fixture', on: library.name, interface: implemented.interface, fixture: record.fixture });
    }
    for (const record of list(library.fixtures)) if (record.ran === true) pieces.push({ kind: 'fixture', on: library.name, interface: null, fixture: record.fixture });
  }
  return pieces;
}

// ---------------------------------------------------------------------------------------------------
// A fixture's piece, as the logic module makes it.

function fixtureOf(lp, sha) {
  const held = lp.assets[sha];
  if (held === undefined) throw blocked(`${lp.folder} carries no asset ${sha} for a fixture it names`);
  return JSON.parse(Buffer.from(held, 'base64').toString('utf8'));
}

/** The interfaces a program imports by name, `lib:<name>@<major>`, each once (interfaces.rs `imported`). */
export function imported(bytes) {
  const out = [];
  if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0x6d736100) return out;
  let at = 8;
  const leb = () => {
    let n = 0, shift = 0, b;
    do { b = bytes[at++]; n += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
    return n;
  };
  const name = () => {
    const n = leb();
    at += n;
    return bytes.subarray(at - n, at).toString('utf8');
  };
  const limits = () => {
    const flags = leb();
    leb();
    if (flags & 1) leb();
  };
  while (at < bytes.length) {
    const id = bytes[at++];
    const end = leb() + at;
    if (id === 2) {
      for (let left = leb(); left > 0; left--) {
        const module = name();
        name();
        const kind = bytes[at++];
        if (kind === 0) {
          leb();
          if (module.startsWith('lib:') && module.includes('@') && !out.includes(module.slice(4))) out.push(module.slice(4));
        } else if (kind === 1) {
          at++;
          limits();
        } else if (kind === 2) limits();
        else if (kind === 3) at += 2;
        else if (kind === 4) {
          at++;
          leb();
        } else throw blocked(`a fixture's program imports something of kind ${kind}, which this suite can't read`);
      }
    }
    at = end;
  }
  return out;
}

/** The `bake` of a library's own fixture, as `run_fixtures` asks for it: the fixture's items beside its own, on its track for its steps. */
export function ownFixtureLine(lp, sha) {
  const fixture = fixtureOf(lp, sha);
  const items = { ...(isObject(fixture.items) ? fixture.items : {}), fixture: fixture.item ?? null };
  return { call: 'bake', piece: { seed: 0, packs: [lp.pack], items, assets: lp.assets }, track: fixture.track ?? [], steps: fixture.steps ?? 1 };
}

/**
 * The `bake` of an interface's fixture on the library `label` of `lp`, as `fixture_call` asks for it: the fixture's
 * item links the library, which a pack of its own carries as implementing every interface the fixture's program
 * imports, with the fixture's controls.
 */
export function interfaceFixtureLine(lp, iface, label, sha) {
  const fixture = fixtureOf(lp, sha);
  const library = lp.pack.libs[label];
  const item = structuredClone(fixture.item ?? null);
  if (!isObject(library) || !isObject(item) || !isObject(item.params)) throw blocked(`${lp.folder}: ${iface}'s fixture ${named(lp, sha)} can't be made a piece on ${label}`);
  const held = typeof item.params.program === 'string' ? lp.assets[item.params.program] : undefined;
  const program = held === undefined ? Buffer.alloc(0) : Buffer.from(held, 'base64');
  const under = {
    name: `${iface} under test`, version: '0', origin: 'installed',
    libs: { [label]: { asset: library.asset, exports: library.exports, fixtures: library.fixtures ?? [], needs: library.needs ?? [], implements: imported(program) } },
  };
  item.params.links = [{ name: label, asset: library.asset }];
  const items = { ...(isObject(fixture.items) ? fixture.items : {}), fixture: item };
  const piece = { seed: 0, packs: [under, lp.pack], items, assets: lp.assets };
  if ('controls' in fixture) piece.controls = fixture.controls;
  return { call: 'bake', piece, track: fixture.track ?? [], steps: fixture.steps ?? 1 };
}

/**
 * The fixture runs of `lp` whose pieces link outside its check too: each library's interfaces' fixtures on it, then
 * its own. (A planted library's piece links only inside the check that judges it, so its runs are read from the
 * check's reply alone.)
 */
export function libraryRuns(lp) {
  const runs = [];
  for (const [label, library] of Object.entries(lp.pack.libs)) {
    for (const iface of list(library.implements)) {
      const declared = lp.pack.interfaces[iface];
      if (!isObject(declared)) throw blocked(`${lp.folder}: ${label} implements ${iface}, which its own pack doesn't declare`);
      for (const fixture of list(declared.fixtures)) runs.push({ on: label, interface: iface, fixture, line: interfaceFixtureLine(lp, iface, label, fixture) });
    }
    for (const fixture of list(library.fixtures)) runs.push({ on: label, interface: null, fixture, line: ownFixtureLine(lp, fixture) });
  }
  return runs;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1: what a pack's check and a library's link count.

/** Each pack's check in one process, with the count read before and after it: its reply and the piece checks it made. */
export async function countedChecks(logic, packs) {
  const out = [];
  for (const lp of packs) {
    const before = await pieceChecks(logic);
    const reply = await packCheck(logic, lp);
    const after = await pieceChecks(logic);
    if (before.count === null || after.count === null) throw blocked(`${logic.name} stopped answering piece_checks around the check of ${lp.folder}: ${brief(after.reply)}`);
    out.push({ folder: lp.folder, reply, checks: after.count - before.count });
  }
  return out;
}

/**
 * One fixture run alone, at a library's link (README: One fixture alone). In a process of its own, the library's
 * interfaces' fixtures are run on it first (a `claim` for each interface), so they are done; then the piece of its
 * own fixture is checked (`check`), which links the library and so runs its own fixtures, and nothing else. Gives
 * the piece checks that `check` made: one for the piece it was given, and those of the library's own fixtures.
 * BLOCKED when the link ran anything but those.
 */
export async function linkChecks(lp, label, planted = []) {
  const library = lp.pack.libs[label];
  const own = list(library.fixtures);
  if (!own.length) throw blocked(`${label} of ${lp.folder} ships no fixture of its own to link by`);
  const logic = openLogic(planted);
  try {
    const piece = { packs: [lp.pack], assets: lp.assets };
    for (const iface of list(library.implements)) {
      const claimed = await logic.send({ call: 'claim', piece, library: label, interface: iface }, `the claim that ${label} implements ${iface}`);
      if (claimed.ok !== true || claimed.verdict !== 'PASS') throw blocked(`${iface}'s fixtures don't pass on ${label} ahead of its link: ${brief(claimed)}`);
    }
    const before = await pieceChecks(logic);
    const linked = await logic.send({ call: 'check', piece: ownFixtureLine(lp, own[0]).piece }, `the check of a piece that links ${label}`);
    const after = await pieceChecks(logic);
    if (before.count === null || after.count === null) throw blocked(`${logic.name} doesn't answer piece_checks around a link of ${label}: ${brief(after.reply)}`);
    const receipt = list(linked.items?.fixture?.libraries).find((l) => l.name === label);
    const ranOwn = list(receipt?.fixtures).filter((r) => r.ran === true).map((r) => r.fixture);
    const ranOthers = list(receipt?.interfaces).flatMap((i) => list(i.fixtures)).filter((r) => r.ran === true).length;
    if (linked.ok !== true || !same(ranOwn, own) || ranOthers !== 0) throw blocked(`the link of ${label} didn't run its own fixtures and only those (${own.length} of its own, ran ${brief(ranOwn)} and ${ranOthers} of its interfaces'): ${brief(linked, 400)}`);
    return { folder: lp.folder, library: label, fixtures: own.map((sha) => named(lp, sha)), checks: after.count - before.count };
  } finally {
    await logic.close();
  }
}

/** `linkChecks` for every library the shipped packs carry. */
export async function everyLink(packs, planted = []) {
  const out = [];
  for (const lp of packs) for (const label of Object.keys(lp.pack.libs)) out.push(await linkChecks(lp, label, planted));
  return out;
}

/**
 * Criterion 1's judge: each fixture's piece is checked once. `checks` are packs' checks (`{folder, checks, pieces}`)
 * and `links` libraries' links (`linkChecks`). A problem names the pack whose check made more piece checks than
 * pieces, and the fixture whose piece a link checked more than once.
 */
export function judgeCounts({ checks, links }) {
  const problems = [];
  for (const { folder, checks: made, pieces } of checks) {
    if (made === pieces.length) continue;
    const twins = pieces.filter((p) => p.kind === 'twin').length;
    problems.push(`the check of ${folder} made ${made} piece checks for ${pieces.length} pieces (${pieces.length - twins} fixture runs${twins ? ` and ${twins} kit twins` : ''})`);
  }
  for (const { library, fixtures, checks: made } of links) {
    // The piece that links the library, and its own fixtures' pieces, once each.
    if (made === 1 + fixtures.length) continue;
    problems.push(fixtures.length === 1
      ? `the piece of ${library}'s fixture ${fixtures[0]} was checked ${made - 1} times at the library's link, not once`
      : `the pieces of ${library}'s ${fixtures.length} fixtures (${fixtures.join(', ')}) were checked ${made - 1} times at the library's link, not once each`);
  }
  return problems;
}
/** The first fixture a problem of `judgeCounts` names as checked twice, or null. */
export const checkedTwice = (problems) => problems.map((p) => /fixture ([0-9a-f]{64}) \([^)]*\) was checked 2 times/.exec(p)?.[1]).find(Boolean) ?? null;

// ---------------------------------------------------------------------------------------------------
// Criterion 2: what every fixture reaches.

const record = (r) => ({ fixture: r?.fixture ?? null, verdict: r?.verdict ?? null, deep_hashes: isObject(r?.deep_hashes) ? r.deep_hashes : {} });
/** A refusal's lasting fields: what it names, never a time. */
export const refusalOf = (r) => Object.fromEntries(['rule', 'interface', 'library', 'fixture', 'step', 'array', 'index', 'field', 'expected', 'actual', 'planted', 'what', 'failures'].filter((k) => r?.[k] !== undefined).map((k) => [k, r[k]]));
const refused = (reply) => ({ ok: false, code: reply.code ?? null, refusals: (Array.isArray(reply.refusals) ? reply.refusals : [reply]).map(refusalOf) });

/** What a pack's check answered that lasts: each fixture's verdict and full-state hashes by step, each planted library's first failed fixture, each kit twin's rules; or its refusals. */
export function checkOf(reply) {
  if (reply.ok !== true) return refused(reply);
  return {
    ok: true,
    libraries: list(reply.libraries).map((l) => ({
      name: l.name, hash: l.hash, fixtures: list(l.fixtures).map(record),
      interfaces: list(l.interfaces).map((i) => ({ interface: i.interface, fixtures: list(i.fixtures).map(record) })),
    })),
    interfaces: list(reply.interfaces).map((i) => ({
      name: i.name, digest: i.digest,
      judged: list(i.judged).map((j) => ({ planted: j.planted, fails: j.fails })),
      kit: list(i.kit).map((k) => ({ planted: k.planted, example: k.example, expect: k.expect, raised: k.raised })),
    })),
  };
}

/** A fixture's piece baked and held to logic.determinism, as its run at a check is: each step with its hash, each checkpoint with its full-state hash, each trap, and the verdict with its failures. */
export async function runOf(logic, run, where) {
  const what = `${run.on}'s fixture ${run.fixture} of ${where}`;
  const bake = await logic.send({ ...run.line, arrays: [] }, `the bake of ${what}`);
  const judged = await logic.send({ ...run.line, call: 'determinism', at_times: [0] }, `logic.determinism on ${what}`);
  const baked = bake.ok === true
    ? {
      steps: list(bake.steps).map((s) => s.step),
      hashes: list(bake.steps).map((s) => s.items?.fixture?.hash ?? null),
      checkpoints: list(bake.checkpoints?.fixture).map((c) => [c.step, c.deep_hash]),
      traps: list(bake.traps).map((t) => [t.step ?? null, t.kind ?? null]),
    }
    : { refused: refused(bake) };
  const determinism = judged.ok === true ? { verdict: judged.verdict ?? null, failures: list(judged.failures) } : { refused: refused(judged) };
  return { on: run.on, interface: run.interface, fixture: run.fixture, ...baked, determinism };
}

/** Every shipped pack's check, then every library fixture's piece, in one process: `{[folder]: {check, runs}}`. */
export async function readFixtures(logic, packs) {
  const out = {};
  for (const lp of packs) {
    const check = checkOf(await packCheck(logic, lp));
    const runs = [];
    for (const run of libraryRuns(lp)) runs.push(await runOf(logic, run, lp.folder));
    out[lp.folder] = { check, runs };
  }
  return out;
}

const failureOf = (f) => `${f?.run ?? 'a'} run, ${f?.field ?? 'a difference'}${f?.array ? ` ${f.array}` : ''}`;
/** The step a refusal or a determinism failure names, or null. */
const stepOf = (r) => r?.step ?? r?.checkpoint ?? list(r?.failures)[0]?.step ?? list(r?.failures)[0]?.checkpoint ?? null;

function hashesMoved(what, was, is) {
  const steps = [...new Set([...Object.keys(was), ...Object.keys(is)])].sort((a, b) => Number(a) - Number(b));
  const step = steps.find((k) => was[k] !== is[k]);
  return step === undefined ? [] : [`${what}: its full-state hash at step ${step} was ${was[step] ?? 'none'} on the merge base and is ${is[step] ?? 'none'}`];
}

function recordsMoved(lp, who, was, is) {
  const out = [];
  for (let n = 0; n < Math.max(was.length, is.length); n++) {
    const [b, a] = [was[n], is[n]];
    const what = `${lp.folder}: ${who}'s fixture ${named(lp, (b ?? a).fixture)}`;
    if (!b || !a || b.fixture !== a.fixture) out.push(`${what}: the check ${b ? 'ran' : 'didn\'t run'} it on the merge base and ${a?.fixture === b?.fixture || !a ? 'doesn\'t run it' : `runs ${a.fixture} in its place`} now`);
    else if (b.verdict !== a.verdict) out.push(`${what}: its verdict at the pack's check was ${b.verdict} on the merge base and is ${a.verdict}`);
    else out.push(...hashesMoved(what, b.deep_hashes, a.deep_hashes));
  }
  return out;
}

function checkMoved(lp, was, is) {
  if (was.ok !== true || is.ok !== true) {
    if (same(was, is)) return [];
    if (is.ok === true) return [`${lp.folder}: its check passes, where the merge base refused it: ${brief(was.refusals, 300)}`];
    return is.refusals.map((r) => `${lp.folder}: its check is refused${was.ok === true ? ', where the merge base passed it' : ' otherwise than on the merge base'}: fixture ${r.fixture ? named(lp, r.fixture) : 'unnamed'}, step ${stepOf(r) ?? 'unnamed'}: ${r.what ?? brief(r, 300)}`);
  }
  const out = [];
  for (let n = 0; n < Math.max(was.libraries.length, is.libraries.length); n++) {
    const [b, a] = [was.libraries[n], is.libraries[n]];
    if (!b || !a || b.name !== a.name || b.hash !== a.hash) {
      out.push(`${lp.folder}: its check lists library ${brief(a?.name ?? null)} (${brief(a?.hash ?? null)}) where the merge base listed ${brief(b?.name ?? null)} (${brief(b?.hash ?? null)})`);
      continue;
    }
    out.push(...recordsMoved(lp, b.name, b.fixtures, a.fixtures));
    for (let i = 0; i < Math.max(b.interfaces.length, a.interfaces.length); i++) {
      const [bi, ai] = [b.interfaces[i], a.interfaces[i]];
      if (!bi || !ai || bi.interface !== ai.interface) out.push(`${lp.folder}: ${b.name} is held to ${brief(ai?.interface ?? null)} where the merge base held it to ${brief(bi?.interface ?? null)}`);
      else out.push(...recordsMoved(lp, `${b.name} under ${bi.interface}`, bi.fixtures, ai.fixtures));
    }
  }
  for (let n = 0; n < Math.max(was.interfaces.length, is.interfaces.length); n++) {
    const [b, a] = [was.interfaces[n], is.interfaces[n]];
    if (!b || !a || b.name !== a.name || b.digest !== a.digest) {
      out.push(`${lp.folder}: its check lists interface ${brief(a?.name ?? null)} where the merge base listed ${brief(b?.name ?? null)}`);
      continue;
    }
    for (let j = 0; j < Math.max(b.judged.length, a.judged.length); j++) {
      const [bj, aj] = [b.judged[j], a.judged[j]];
      if (!same(bj, aj)) out.push(`${lp.folder}: ${b.name}'s planted library ${(bj ?? aj).planted} failed fixture ${bj?.fails ? named(lp, bj.fails) : 'none'} first on the merge base and fails ${aj?.fails ? named(lp, aj.fails) : 'none'} first now`);
    }
    for (let k = 0; k < Math.max(b.kit.length, a.kit.length); k++) {
      const [bk, ak] = [b.kit[k], a.kit[k]];
      if (!same(bk, ak)) out.push(`${lp.folder}: ${b.name}'s kit twin on fixture ${named(lp, (bk ?? ak).example)} raised ${brief(bk?.raised ?? null)} on the merge base and raises ${brief(ak?.raised ?? null)} now`);
    }
  }
  return out;
}

function runMoved(lp, was, is) {
  const what = `${lp.folder}: ${was.on}'s fixture ${named(lp, was.fixture)}`;
  if (!is || is.on !== was.on || is.fixture !== was.fixture) return [`${what}: its piece wasn't baked now`];
  if (was.refused || is.refused) return same(was.refused, is.refused) ? [] : [`${what}: its bake ${is.refused ? `is refused (${brief(is.refused.refusals, 300)})` : 'passes'}, and on the merge base it ${was.refused ? `was refused (${brief(was.refused.refusals, 300)})` : 'passed'}`];
  const out = [];
  const at = [...was.hashes.keys(), ...is.hashes.keys()].sort((a, b) => a - b).find((n) => was.hashes[n] !== is.hashes[n] || was.steps[n] !== is.steps[n]);
  if (at !== undefined) {
    out.push(was.steps[at] === is.steps[at]
      ? `${what}: step ${was.steps[at]}'s hash was ${was.hashes[at]} on the merge base and is ${is.hashes[at]}`
      : `${what}: row ${at + 1} of its steps was step ${was.steps[at] ?? 'none'} (hash ${was.hashes[at] ?? 'none'}) on the merge base and is step ${is.steps[at] ?? 'none'} (hash ${is.hashes[at] ?? 'none'})`);
  }
  const checkpoint = [...was.checkpoints.keys(), ...is.checkpoints.keys()].sort((a, b) => a - b).find((n) => !same(was.checkpoints[n], is.checkpoints[n]));
  if (checkpoint !== undefined) {
    const [b, a] = [was.checkpoints[checkpoint], is.checkpoints[checkpoint]];
    out.push(`${what}: its checkpoint at step ${(b ?? a)[0]} had the full-state hash ${b?.[1] ?? 'none'} on the merge base and has ${a && a[0] === (b ?? a)[0] ? a[1] : `none (the next is step ${a?.[0] ?? 'none'}'s)`}`);
  }
  if (!same(was.traps, is.traps)) out.push(`${what}: it trapped at ${brief(was.traps)} (step, kind) on the merge base and traps at ${brief(is.traps)}, step ${(is.traps[0] ?? was.traps[0])?.[0]} first`);
  const [b, a] = [was.determinism, is.determinism];
  if (b.refused || a.refused) {
    if (!same(b.refused, a.refused)) out.push(`${what}: logic.determinism ${a.refused ? `is refused (${brief(a.refused.refusals, 300)})` : 'runs'}, and on the merge base it ${b.refused ? 'was refused' : 'ran'}`);
  } else if (b.verdict !== a.verdict) {
    const first = a.failures[0] ?? b.failures[0];
    out.push(`${what}: its logic.determinism verdict was ${b.verdict} on the merge base and is ${a.verdict}${first ? `: step ${stepOf(first)}, in ${failureOf(first)}` : ''}`);
  } else if (!same(b.failures, a.failures)) {
    const n = [...b.failures.keys(), ...a.failures.keys()].find((i) => !same(b.failures[i], a.failures[i]));
    out.push(`${what}: logic.determinism fails otherwise than on the merge base: step ${stepOf(a.failures[n] ?? b.failures[n])}, ${brief(a.failures[n] ?? null, 300)} where the merge base gave ${brief(b.failures[n] ?? null, 300)}`);
  }
  return out;
}

/**
 * Criterion 2's judge: every fixture reaches what it reached on the merge base. `base` and `now` are `readFixtures`'
 * of the merge base (the recording) and of this build. Each problem names the fixture and the step.
 */
export function judgeFixtures(packs, base, now) {
  const problems = [];
  for (const lp of packs) {
    const [was, is] = [base[lp.folder], now[lp.folder]];
    if (!was || !is) throw blocked(`${lp.folder} has no ${was ? 'reading' : 'recording'}: the recording is of the merge base's packs`);
    problems.push(...checkMoved(lp, was.check, is.check));
    for (let n = 0; n < was.runs.length; n++) problems.push(...runMoved(lp, was.runs[n], is.runs[n]));
    if (is.runs.length !== was.runs.length) throw blocked(`${lp.folder} has ${is.runs.length} library fixtures and the recording ${was.runs.length}: the recording is of the merge base's packs`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: what a planted runner's fixture run answers.

/** Whether a refusal is a fixture failing logic.determinism: it names the fixture and what the run compared. */
export const failsDeterminism = (r) => typeof r?.fixture === 'string' && Array.isArray(r.failures) && /logic\.determinism/.test(String(r.what));

/** Where a planted runner's fixture run is asked for: a pack's check, or the link of one of its libraries. */
export function plantedCall(lp, site) {
  if (site === 'check') return { line: { call: 'pack_check', pack: lp.pack, assets: lp.assets }, what: `the check of ${lp.folder}` };
  const library = lp.pack.libs[site];
  if (!isObject(library) || !list(library.fixtures).length) throw blocked(`${lp.folder} carries no library ${site} with a fixture of its own to link by`);
  return { line: { call: 'check', piece: ownFixtureLine(lp, library.fixtures[0]).piece }, what: `the link of ${site} of ${lp.folder}` };
}

/** What the call answered that lasts: `{ok: true}`, or its code and refusals. */
export const plantedOf = (reply) => (reply.ok === true ? { ok: true } : refused(reply));

/**
 * Criterion 3's judge, for one planted runner at one site: `was` is what the merge base answered (the recording: a
 * refusal that names a fixture as failing logic.determinism, with what the run compared) and `is` what this build
 * answers. Each problem names the fixture. `varies`: the merge base's own failures differ from run to run (a runner
 * that reads the wall clock), so only the fixture is held.
 */
export function judgePlanted(lp, runner, site, was, is, varies = false) {
  const expected = was.refusals[0];
  const where = `${site === 'check' ? `the check of ${lp.folder}` : `the link of ${site} (${lp.folder})`} under the planted runner ${runner}`;
  const fixture = `fixture ${named(lp, expected.fixture)}`;
  if (is.ok === true) return [`${where} passes: on the merge base ${fixture} failed logic.determinism there (${failureOf(expected.failures[0])}, step ${stepOf(expected)})`];
  const got = is.refusals[0];
  if (is.code !== was.code || !failsDeterminism(got) || got.fixture !== expected.fixture) {
    return [`${where} no longer fails ${fixture} under logic.determinism, as it did on the merge base: it is refused (${is.code}) for ${got?.fixture ? `fixture ${named(lp, got.fixture)}` : 'no fixture'}: ${got?.what ?? brief(got, 300)}`];
  }
  if (varies) return [];
  if (!same(got.failures, expected.failures)) {
    const n = [...expected.failures.keys(), ...got.failures.keys()].find((i) => !same(expected.failures[i], got.failures[i]));
    return [`${where} fails ${fixture} under logic.determinism, but not by what it compared on the merge base: ${brief(got.failures[n] ?? null, 300)} where the merge base gave ${brief(expected.failures[n] ?? null, 300)} (${got.failures.length} failures now, ${expected.failures.length} then)`];
  }
  if (!same(is.refusals.map((r) => r.fixture ?? null), was.refusals.map((r) => r.fixture ?? null))) return [`${where} fails ${fixture} under logic.determinism and refuses otherwise beside it: ${brief(is.refusals.map((r) => r.what), 300)}`];
  return [];
}

// ---------------------------------------------------------------------------------------------------
// The merge base's recording (README: The recording).

const RECORDING = new URL('./base.json', import.meta.url);
/** base.json, the merge base's own values, written there by record.mjs; BLOCKED when it is missing or not whole. */
export function recording() {
  let base;
  try {
    base = JSON.parse(readFileSync(RECORDING, 'utf8'));
  } catch (error) {
    throw blocked(`tests/acceptance/3612/base.json, the merge base's recording, can't be read (${error.code ?? error.message}); node tests/acceptance/3612/record.mjs writes it at the merge base`);
  }
  if (!isObject(base.fixtures) || !Array.isArray(base.planted) || typeof base.commit !== 'string') throw blocked('tests/acceptance/3612/base.json holds no commit, fixtures and planted runners');
  return base;
}
