import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, blocked, brief, isObject, list } from './common.mjs';
import { mixerProgramOf2662, sha256 } from './wasm.mjs';

const keptFile = (path) => {
  let bytes;
  try {
    bytes = readFileSync(join(REPO, path));
  } catch (error) {
    throw blocked(`${path}, which the merge base keeps, can't be read (${error.code ?? error.message})`);
  }
  return { sha: createHash('sha256').update(bytes).digest('hex'), value: JSON.parse(bytes.toString('utf8')) };
};

function pieceOfGolden2662() {
  const items = [
    ['a', mixerProgramOf2662(512, 8), { reads: ['wind'], writes: { x: { type: 'f64', count: 8 } }, checkpoint: { every: 30 } }],
    ['b', mixerProgramOf2662(128, 8), { reads: ['a.x'], writes: { y: { type: 'f64', count: 8, interpolate: 'linear' } }, checkpoint: { every: 30 } }],
    ['c', mixerProgramOf2662(256, 4), { reads: ['a.x', 'b.y'], writes: { z: { type: 'f64', count: 4 } }, checkpoint: { every: 30 } }],
  ];
  const assets = {}, listed = {};
  for (const [id, bytes, params] of items) {
    const sha = sha256(bytes);
    assets[sha] = bytes.toString('base64');
    listed[id] = { kind: 'logic@1', params: { ...params, program: sha } };
  }
  const entry = (step, value) => ({ t: step * (705_600_000 / 60), seq: 0, control: 'wind', value, writer: 'you', player: 1 });
  return { piece: { seed: 2662, controls: { wind: { kind: 'slider' } }, assets, items: listed }, track: [entry(3, 0.25), entry(37, -1.5), entry(38, 4.0), entry(200, 0.125)], steps: 240 };
}

export function keptFixturesAndGoldens() {
  const fixtures = keptFile('tests/acceptance/2324/fixtures/base-bake.json');
  const g2324 = keptFile('tests/acceptance/2324/fixtures/base-golden.json');
  const g2662 = keptFile('tests/acceptance/2662/fixtures/golden.json');
  for (const [file, { value }] of [['tests/acceptance/2324/fixtures/base-bake.json', fixtures], ['tests/acceptance/2324/fixtures/base-golden.json', g2324]]) {
    if (!isObject(value.piece) || !Array.isArray(value.track) || !Number.isSafeInteger(value.steps)) throw blocked(`${file} holds no piece, track and steps`);
  }
  if (!isObject(g2324.value.golden) || !isObject(g2662.value.golden)) throw blocked('a kept golden file holds no golden');
  const asGoldensRsWritesIt = pieceOfGolden2662();
  return [
    {
      key: 'fixtures', name: "#531's fixtures", file: 'tests/acceptance/2324/fixtures/base-bake.json', sha: fixtures.sha, golden: null,
      of: (item) => `#531's fixture ${item} (tests/acceptance/2324/fixtures/base-bake.json)`,
      line: { call: 'bake', piece: fixtures.value.piece, track: fixtures.value.track, steps: fixtures.value.steps, arrays: [] },
    },
    {
      key: 'golden2324', name: "#2324's golden", file: 'tests/acceptance/2324/fixtures/base-golden.json', sha: g2324.sha, golden: g2324.value.golden,
      of: (item) => `#2324's golden (tests/acceptance/2324/fixtures/base-golden.json), item ${item}`,
      line: { call: 'golden', piece: g2324.value.piece, track: g2324.value.track, steps: g2324.value.steps },
    },
    {
      key: 'golden2662', name: "#2662's golden", file: 'tests/acceptance/2662/fixtures/golden.json', sha: g2662.sha, golden: g2662.value.golden,
      of: (item) => `#2662's golden (tests/acceptance/2662/fixtures/golden.json), item ${item}`,
      line: { call: 'golden', ...asGoldensRsWritesIt },
    },
  ];
}

const checkpoints = (rows) => list(rows).map((c) => [c.step, c.deep_hash]);

export const hashesInGoldenFile = (golden) => Object.fromEntries(Object.keys(golden.step_hashes ?? {}).map((id) => [id, { steps: list(golden.step_hashes[id]), checkpoints: checkpoints(golden.checkpoint_hashes?.[id]) }]));

export async function hashesReached(logic, one) {
  const reply = await logic.send(one.line, `${one.name}`);
  if (reply.ok !== true) throw blocked(`${logic.name} refuses ${one.name} (${one.file}): ${brief(reply, 600)}`);
  if (one.line.call === 'golden') {
    if (!isObject(reply.golden?.step_hashes)) throw blocked(`${logic.name} records no golden for ${one.name}: ${brief(reply, 400)}`);
    return { items: hashesInGoldenFile(reply.golden), keys: reply.golden.bake_key ?? null };
  }
  const steps = list(reply.steps);
  if (!steps.length || steps.some((s, n) => s.step !== n)) throw blocked(`${logic.name} bakes ${one.name} into rows that aren't its steps 0 to ${one.line.steps - 1}: ${brief(steps.map((s) => s.step), 200)}`);
  const ids = Object.keys(one.line.piece.items);
  return { items: Object.fromEntries(ids.map((id) => [id, { steps: steps.map((s) => s.items?.[id]?.hash ?? null), checkpoints: checkpoints(reply.checkpoints?.[id]) }])), keys: null };
}

export async function allHashesReached(logic, all) {
  const out = {};
  for (const one of all) out[one.key] = (await hashesReached(logic, one)).items;
  return out;
}

export function hashesMoved(one, was, is, then = 'on the merge base') {
  const problems = [];
  for (const id of Object.keys(was)) {
    const [b, a] = [was[id], is[id]];
    if (!a) {
      problems.push(`${one.of(id)}: step 0: it reached ${b.steps.length} step hashes ${then} and is no item of the run now`);
      continue;
    }
    const step = [...Array(Math.max(b.steps.length, a.steps.length)).keys()].find((n) => b.steps[n] !== a.steps[n]);
    if (step !== undefined) problems.push(`${one.of(id)}: step ${step}'s hash was ${b.steps[step] ?? 'none'} ${then} and is ${a.steps[step] ?? 'none'}`);
    const n = [...Array(Math.max(b.checkpoints.length, a.checkpoints.length)).keys()].find((i) => b.checkpoints[i]?.[0] !== a.checkpoints[i]?.[0] || b.checkpoints[i]?.[1] !== a.checkpoints[i]?.[1]);
    if (n !== undefined) {
      const [bc, ac] = [b.checkpoints[n], a.checkpoints[n]];
      problems.push(`${one.of(id)}: step ${(bc ?? ac)[0]}: its checkpoint's full-state hash was ${bc?.[1] ?? 'none'} ${then} and is ${ac && ac[0] === (bc ?? ac)[0] ? ac[1] : `none (the next checkpoint is step ${ac?.[0] ?? 'none'}'s)`}`);
    }
  }
  return problems;
}

export function hashesMovedFromRecording(all, recording, now) {
  const problems = [];
  for (const one of all) {
    if (recording.files?.[one.file] !== one.sha) throw blocked(`${one.file} isn't the file base.json was recorded from (its SHA-256 is ${one.sha}, the recording's ${recording.files?.[one.file] ?? 'none'}): base.json is the merge base's recording of the kept files`);
    const [was, is] = [recording.reached?.[one.key], now[one.key]];
    if (!isObject(was) || !isObject(is)) throw blocked(`${one.name} has no ${isObject(was) ? 'reading' : 'recording'}`);
    problems.push(...hashesMoved(one, was, is));
  }
  return problems;
}
export const namesStepOf = (problem, one, step) => problem.startsWith(one.key === 'fixtures' ? "#531's fixture " : `${one.name} `) && problem.includes(`: step ${step}'s hash was `);

const RECORDING_FILE = new URL('./base.json', import.meta.url);
export function mergeBaseRecording() {
  let base;
  try {
    base = JSON.parse(readFileSync(RECORDING_FILE, 'utf8'));
  } catch (error) {
    throw blocked(`tests/acceptance/3529/base.json, the merge base's recording, can't be read (${error.code ?? error.message}); node tests/acceptance/3529/record.mjs writes it at the merge base`);
  }
  if (!isObject(base.reached) || !isObject(base.files) || typeof base.commit !== 'string') throw blocked('tests/acceptance/3529/base.json holds no commit, files and reached hashes');
  return base;
}
