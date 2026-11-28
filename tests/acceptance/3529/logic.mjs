import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ISSUE_PROGRAMS, REPO, suppliedOrBuiltBinary, blocked, brief, isObject, list, openLineProgram } from './common.mjs';
import { bakeOfBothItems } from './items.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const PACK_FOLDERS_THE_ISSUE_READ = [
  'art-1.0.0', 'blender-1.0.0', 'chrome-fx-1.0.0', 'circuit-1.0.0', 'composites-1.0.0', 'explain-1.0.0', 'familiar-1.0.0',
  'familiar-1.1.0', 'foley-1.0.0', 'fx-1.0.0', 'godot-1.0.0', 'godot-1.1.0', 'interfaces-1.0.0', 'lanes-1.0.0', 'math-1.0.0',
  'modslib-1.0.0', 'process-1.0.0', 'sense-1.0.0', 'separation-1.0.0', 'unreal-1.0.0', 'verbs-1.0.0',
];

export function shippedPacks() {
  const root = join(REPO, 'packs');
  const folders = readdirSync(root).sort().filter((folder) => existsSync(join(root, folder, 'pack.json')));
  const gone = PACK_FOLDERS_THE_ISSUE_READ.filter((folder) => !folders.includes(folder));
  if (gone.length) throw blocked(`packs/ no longer ships ${gone.join(', ')}, which the issue's counts were read on`);
  return folders.map((folder) => {
    const manifest = JSON.parse(readFileSync(join(root, folder, 'pack.json'), 'utf8'));
    return { folder, dir: join(root, folder), id: `deepbuild/${manifest.name}`, manifest, readByIssue: PACK_FOLDERS_THE_ISSUE_READ.includes(folder) };
  });
}

export function logicPacks() {
  return shippedPacks().filter(({ manifest }) => manifest.libs !== undefined || manifest.interfaces !== undefined).map(({ folder, dir, manifest, readByIssue }) => {
    const assets = {}, paths = {};
    for (const asset of list(manifest.assets)) {
      const bytes = readFileSync(join(dir, asset.path));
      if (sha256(bytes) !== asset.sha256) throw blocked(`packs/${folder}/${asset.path} doesn't hash to the SHA-256 its pack.json lists`);
      assets[asset.sha256] = bytes.toString('base64');
      paths[asset.sha256] = `packs/${folder}/${asset.path}`;
    }
    const pack = { name: manifest.name, version: manifest.version, origin: 'first_party', libs: manifest.libs ?? {}, interfaces: manifest.interfaces ?? {} };
    return { folder, manifest, pack, assets, paths, readByIssue };
  });
}

export const assetName = (lp, sha) => `${sha} (${lp.paths[sha] ?? 'no asset of the pack'})`;

export function openLogic(planted = []) {
  return openLineProgram(suppliedOrBuiltBinary('deep-logic'), planted.flatMap((name) => ['--planted', name]), ['deep-logic', ...planted.map((name) => `--planted ${name}`)].join(' '));
}

export async function compileCount(logic) {
  const reply = await logic.send({ call: 'compiles' }, 'compiles');
  const n = reply.compiles;
  return { reply, count: reply.ok === true && Number.isSafeInteger(n) && n >= 0 ? n : null };
}

async function replyAndCompiles(logic, line, what) {
  const before = await compileCount(logic);
  const reply = await logic.send(line, what);
  const after = await compileCount(logic);
  if (before.count === null || after.count === null) throw blocked(`${logic.name} stopped answering compiles around ${what}: ${brief(after.reply)}`);
  return { reply, made: after.count - before.count };
}

export function programAndLibraryOfEachPiece(lp, reply) {
  if (reply.ok !== true || !Array.isArray(reply.libraries) || !Array.isArray(reply.interfaces)) throw blocked(`the check of ${lp.folder} lists no libraries and interfaces: ${brief(reply)}`);
  const pieces = [];
  const programOf = (fixture) => fixtureJson(lp, fixture).item?.params?.program ?? `the program of ${fixture}`;
  for (const row of reply.interfaces) {
    const declared = lp.pack.interfaces[row.label ?? row.name];
    if (!isObject(declared)) throw blocked(`the check of ${lp.folder} lists an interface its pack.json doesn't declare: ${brief(row, 200)}`);
    for (const judged of list(row.judged)) {
      const failed = list(declared.fixtures).indexOf(judged.fails);
      if (failed < 0) throw blocked(`the check of ${lp.folder} doesn't say which of ${row.name}'s fixtures its planted library ${judged.planted} failed (${brief(judged.fails)}), so the fixtures it ran can't be counted`);
      for (const fixture of declared.fixtures.slice(0, failed + 1)) pieces.push(`${programOf(fixture)} on ${judged.planted}`);
    }
    for (const twin of list(row.kit)) pieces.push(`${programOf(twin.example)} on ${twin.planted}`);
  }
  for (const library of reply.libraries) {
    const asset = lp.pack.libs[library.name]?.asset ?? library.hash;
    for (const implemented of list(library.interfaces)) {
      for (const record of list(implemented.fixtures)) if (record.ran === true) pieces.push(`${programOf(record.fixture)} on ${asset}`);
    }
    for (const record of list(library.fixtures)) {
      if (record.ran !== true) continue;
      const links = list(fixtureJson(lp, record.fixture).item?.params?.links).map((link) => link.asset).join(' and ');
      pieces.push(`${programOf(record.fixture)} on ${links}`);
    }
  }
  return pieces;
}

function fixtureJson(lp, sha) {
  const held = lp.assets[sha];
  if (held === undefined) throw blocked(`${lp.folder} carries no asset ${sha} for a fixture it names`);
  return JSON.parse(Buffer.from(held, 'base64').toString('utf8'));
}

function importedInterfaces(bytes) {
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

function bakeOfOwnFixture(lp, sha) {
  const fixture = fixtureJson(lp, sha);
  const items = { ...(isObject(fixture.items) ? fixture.items : {}), fixture: fixture.item ?? null };
  return { call: 'bake', piece: { seed: 0, packs: [lp.pack], items, assets: lp.assets }, track: fixture.track ?? [], steps: fixture.steps ?? 1 };
}

function bakeOfInterfaceFixture(lp, iface, label, sha) {
  const fixture = fixtureJson(lp, sha);
  const library = lp.pack.libs[label];
  const item = structuredClone(fixture.item ?? null);
  if (!isObject(library) || !isObject(item) || !isObject(item.params)) throw blocked(`${lp.folder}: ${iface}'s fixture ${assetName(lp, sha)} can't be made a piece on ${label}`);
  const held = typeof item.params.program === 'string' ? lp.assets[item.params.program] : undefined;
  const program = held === undefined ? Buffer.alloc(0) : Buffer.from(held, 'base64');
  const under = {
    name: `${iface} under test`, version: '0', origin: 'installed',
    libs: { [label]: { asset: library.asset, exports: library.exports, fixtures: library.fixtures ?? [], needs: library.needs ?? [], implements: importedInterfaces(program) } },
  };
  item.params.links = [{ name: label, asset: library.asset }];
  const items = { ...(isObject(fixture.items) ? fixture.items : {}), fixture: item };
  const piece = { seed: 0, packs: [under, lp.pack], items, assets: lp.assets };
  if ('controls' in fixture) piece.controls = fixture.controls;
  return { call: 'bake', piece, track: fixture.track ?? [], steps: fixture.steps ?? 1 };
}

export function libraryFixtureBakes(lp) {
  const runs = [];
  for (const [label, library] of Object.entries(lp.pack.libs)) {
    for (const iface of list(library.implements)) {
      const declared = lp.pack.interfaces[iface];
      if (!isObject(declared)) throw blocked(`${lp.folder}: ${label} implements ${iface}, which its own pack doesn't declare`);
      for (const fixture of list(declared.fixtures)) runs.push({ on: label, fixture, line: bakeOfInterfaceFixture(lp, iface, label, fixture) });
    }
    for (const fixture of list(library.fixtures)) runs.push({ on: label, fixture, line: bakeOfOwnFixture(lp, fixture) });
  }
  return runs;
}

export async function compileReadings(logic, packs, { again = true } = {}) {
  const checks = [];
  for (const lp of packs) {
    const { reply, made } = await replyAndCompiles(logic, { call: 'pack_check', pack: lp.pack, assets: lp.assets }, `the check of ${lp.folder}`);
    if (reply.ok !== true) throw blocked(`${logic.name} refuses the check of ${lp.folder}, so its compiles can't be counted: ${brief(reply, 400)}`);
    const pieces = programAndLibraryOfEachPiece(lp, reply);
    checks.push({ folder: lp.folder, readByIssue: lp.readByIssue, made, pieces: pieces.length, differentProgramAndLibraryPairs: new Set(pieces).size });
  }
  const seconds = [];
  let pair = null;
  if (again) {
    for (const lp of packs) {
      for (const run of libraryFixtureBakes(lp)) {
        const what = `${run.on}'s fixture ${assetName(lp, run.fixture)}`;
        const line = { ...run.line, arrays: [] };
        const [one, two] = [await replyAndCompiles(logic, line, `a bake of ${what}`), await replyAndCompiles(logic, line, `a second bake of ${what}`)];
        const item = one.reply.items?.fixture;
        if (one.reply.ok !== true || two.reply.ok !== true || typeof item?.hash !== 'string' || two.reply.items?.fixture?.hash !== item.hash) throw blocked(`${logic.name} doesn't bake ${what} of ${lp.folder} twice, as its pack's check baked it: ${brief(one.reply.ok === true ? two.reply : one.reply, 400)}`);
        seconds.push({ folder: lp.folder, what, hash: item.hash, from: lp.paths[item.program] ?? `program ${item.program}`, first: one.made, made: two.made });
      }
    }
    const line = bakeOfBothItems();
    const [first, second] = [await replyAndCompiles(logic, line, 'the bake of two items of one program'), await replyAndCompiles(logic, line, 'a second bake of two items of one program')];
    const hashes = ['a', 'b'].map((id) => first.reply.items?.[id]?.hash);
    if (first.reply.ok !== true || second.reply.ok !== true || typeof hashes[0] !== 'string' || hashes[0] !== hashes[1]) throw blocked(`${logic.name} doesn't bake this suite's piece of two items of one program as two items of the same bytes (their rewritten programs: ${brief(hashes)}): ${brief(first.reply, 400)}`);
    pair = { hash: hashes[0], made: [first.made, second.made] };
  }
  const sum = (of) => checks.reduce((total, check) => total + of(check), 0);
  return { checks, again: seconds, pair, made: sum((c) => c.made), madeOnPacksTheIssueRead: sum((c) => (c.readByIssue ? c.made : 0)), pieces: sum((c) => c.pieces) };
}

export function compiledAgainProblems({ checks, again, pair }) {
  const problems = [];
  for (const { folder, readByIssue, made, pieces, differentProgramAndLibraryPairs } of checks) {
    if (!readByIssue && made > differentProgramAndLibraryPairs) problems.push(`the check of ${folder}, a pack the issue's counts don't cover, counted ${made} compiles for its ${pieces} pieces, more than the ${differentProgramAndLibraryPairs} different pairs of a fixture's program and the library it runs on: a program was compiled more than once there`);
  }
  for (const { folder, what, hash, from, made } of again) {
    if (made > 0) problems.push(`program ${hash} (${from}, the item of ${what}) was compiled twice: this process had compiled it, for the check of ${folder} and a bake of the same piece, and compiled it ${made === 1 ? 'again' : `${made} times more`} for a second item of the same bytes`);
  }
  if (pair) {
    const [first, second] = pair.made;
    if (first !== 1) problems.push(`program ${pair.hash} (this suite's, the item of a and of b in one piece) was compiled ${first === 2 ? 'twice' : `${first} times`}: ${first} compiles for two items of the same bytes, not one`);
    if (second !== 0) problems.push(`program ${pair.hash} (this suite's, the item of a and of b in one piece) was compiled twice: for its piece, and ${second === 1 ? 'again' : `${second} times more`} when the same piece was baked again`);
  }
  return problems;
}
export const firstProgramNamed = (problems) => problems.map((p) => /^program ([0-9a-f]{64}) .* was compiled twice/.exec(p)?.[1]).find(Boolean) ?? null;

export const countsByPack = (checks) => checks.map(({ folder, made, pieces }) => `${folder} ${made} for ${pieces} pieces`).join(', ');

export const ISSUE = `the issue counts ${ISSUE_PROGRAMS} different programs in the checks of the ${PACK_FOLDERS_THE_ISSUE_READ.length} packs it read`;
