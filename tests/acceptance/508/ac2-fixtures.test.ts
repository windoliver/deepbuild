// AC2: "The turbofan and the image-layer explainer fixtures run as documents with no plug-in code per frame, pass the
// document checks, and export to MP4"
//
// Each fixture is a document kept at tests/fixtures/figures/<name>/figure.json, its files in assets/ beside it (README:
// Surfaces this job invents). One `deep-show run` per fixture, as the agent: `deep_show` (presented, no item skipped
// as an unknown kind, no error: the document checks), `registry`, `sandbox`, `eval` at a quarter, a half and three
// quarters of its span with `film: true` and an input track that moves its control to the top of its range at a
// tenth of the span (the turbofan's throttle slider, the image-layer explainer's spread), `sandbox` again, and `export`
// with `video: {codec: "h264"}`. "No plug-in code per frame" as #504's board reads it: every evaluated frame runs only
// operators the build sealed, no stepping module steps, and the sandbox runs nothing between the first frame and the
// last. "Export to MP4": the reply is `exported`, and the file is an MP4 whose one video track is H.264 with one sample
// per frame the receipt hashes. The documents carry what the issue names: the turbofan a throttle slider, the
// image-layer explainer its spread control and the five keyed shots, each with its own camera. Wrong programs: the
// base (no fixture: BLOCKED); a fixture the checks refuse, one that runs code per frame, or one that doesn't export.
import { join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import {
  DOC, LAYER_SHOTS, SPREAD, THROTTLE, TIMEOUT, ac, checkFailures, entry, fixture, fl, isObject, none, putEvidence, readMovie, runShow, scenarioOf,
  show, showDoc, spanOf, topOf, trackOf, useBins, useDir, type Fixture, type JsonObject,
} from './helpers.ts';

const bin = useBins();
const dir = useDir();

/** What the issue names in each fixture, one sentence per miss. */
function contentFailures(f: Fixture): string[] {
  const failures: string[] = [];
  const controls = isObject(f.document['controls']) ? f.document['controls'] : {};
  if (f.name === 'turbofan') {
    const t = controls[THROTTLE];
    if (!isObject(t) || t['kind'] !== 'slider') failures.push(`${f.rel}: no throttle slider: controls.${THROTTLE} is ${show(t ?? null)}`);
  } else {
    if (!isObject(controls[SPREAD])) failures.push(`${f.rel}: no control spreads the panes: controls.${SPREAD} is ${show(controls[SPREAD] ?? null)}`);
    const shots = isObject(f.document['shots']) ? f.document['shots'] : {};
    if (JSON.stringify(Object.keys(shots).sort()) !== JSON.stringify([...LAYER_SHOTS].sort())) failures.push(`${f.rel}: its shots are ${show(Object.keys(shots))}, not the five keyed shots ${LAYER_SHOTS.join(', ')}`);
    const cameras = LAYER_SHOTS.map((s) => (isObject(shots[s]) ? shots[s]['camera'] : undefined));
    if (new Set(cameras.filter((c) => typeof c === 'string')).size !== LAYER_SHOTS.length) failures.push(`${f.rel}: the five shots don't each have a camera of their own: ${show(cameras)}`);
  }
  return failures;
}

function runFailures(f: Fixture): string[] {
  const root = dir();
  const evidence = join(root, 'evidence');
  mkdirSync(evidence, { recursive: true });
  for (const a of f.assets.values()) putEvidence(evidence, a.bytes);
  const span = spanOf(f.document, f.rel);
  const control = f.name === 'turbofan' ? THROTTLE : SPREAD;
  const track = [entry(span / 10, control, topOf(f.document, control, f.rel))];
  const times = [0.25, 0.5, 0.75].map((k) => k * span);
  const out = join(root, `${f.name}.mp4`);
  const calls: JsonObject[] = [
    showDoc(f.document), { call: 'registry' }, { call: 'sandbox' },
    ...times.map((s) => ({ call: 'eval', doc: DOC, t: fl(s), film: true, track })),
    { call: 'sandbox' }, { call: 'export', doc: DOC, out, video: { codec: 'h264' } },
  ];
  const replies = runShow(bin('deep-show'), scenarioOf(evidence, f.size, calls), f.rel);
  const failures = checkFailures(replies[0]!, `${f.rel}: deep_show`);
  // No plug-in code per frame.
  const registry = replies[1]!;
  const sealed = new Set([...(Array.isArray(registry['modules']) ? registry['modules'].filter((m): m is string => typeof m === 'string') : []), 'core']);
  const operators = isObject(registry['operators']) ? registry['operators'] : {};
  times.forEach((s, k) => {
    const e = replies[3 + k]!;
    const at = `${f.rel}: the frame at ${s.toFixed(2)} s`;
    if (e['outcome'] !== 'evaluated') { failures.push(`${at} isn't evaluated: ${show(e, 1500)}`); return; }
    const nodes = Array.isArray(e['nodes']) ? e['nodes'].filter(isObject) : [];
    if (nodes.length === 0) failures.push(`${at} lists no nodes, so nothing says what its evaluation ran`);
    for (const n of nodes) {
      const op = typeof n['operator'] === 'string' ? n['operator'] : '';
      const sealedOp = operators[op];
      if (!isObject(sealedOp) || sealedOp['module'] !== n['module'] || typeof n['module'] !== 'string' || !sealed.has(n['module'])) failures.push(`${at} ran ${show(n, 300)}, which isn't an operator the build sealed`);
    }
    if (!Array.isArray(e['steps']) || e['steps'].length > 0) failures.push(`${at}: a stepping module stepped: ${show(e['steps'] ?? null, 600)}`);
  });
  const before = replies[2]!['runs']; const after = replies[3 + times.length]!['runs'];
  if (typeof before !== 'number' || before !== after) failures.push(`${f.rel}: the sandbox ran programs during the frames: its runs went from ${show(before ?? null)} to ${show(after ?? null)}`);
  // Export to MP4.
  const exported = replies[4 + times.length]!;
  if (exported['outcome'] !== 'exported') failures.push(`${f.rel}: the export isn't delivered: ${show(exported, 2000)}`);
  else {
    const receipt = isObject(exported['receipt']) ? exported['receipt'] : {};
    const hashes = Array.isArray(receipt['frame_hashes']) ? receipt['frame_hashes'].length : 0;
    const video = trackOf(readMovie(readFileSync(out), `${f.rel}: the MP4`), 'vide', `${f.rel}: the MP4`);
    if (!/^avc[13]$/.test(video.entry)) failures.push(`${f.rel}: the MP4's video track is ${video.entry}, not H.264`);
    if (hashes === 0 || video.samples !== hashes) failures.push(`${f.rel}: the MP4 holds ${video.samples} video samples for the ${hashes} frames its receipt hashes`);
  }
  return failures;
}

describe(`${ac(2)} the turbofan and the image-layer explainer run as documents, pass the document checks and export to MP4`, () => {
  for (const name of ['turbofan', 'image-layers'] as const) {
    it(`${ac(2)} the ${name} fixture runs as a document with no plug-in code per frame, passes the document checks and exports to MP4`, () => {
      const f = fixture(name);
      none([...contentFailures(f), ...runFailures(f)], `the ${name} fixture`);
    }, TIMEOUT);
  }
});
