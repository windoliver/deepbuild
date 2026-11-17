// AC2 #1045.acc208bf: "A screen-reader smoke test over the same figure in the web player, with VoiceOver on Safari on the
// reference Mac, names every part and control and announces the changed readout; without that run the check is BLOCKED
// with one unblock ask, never PASS"
//
// No test turns VoiceOver on or drives Safari: the run is a person's, by ear, recorded in VOICEOVER.json (README: The
// VoiceOver run). This test exports the same figure's bundle to target/acceptance/1045/voiceover/, where the person opens
// it, and reads the record. No record, or one made on another bundle or off the reference Macs, is BLOCKED with the one
// unblock ask; a recorded `fail` fails; a `pass` on exactly this bundle passes only when what the person heard names
// every part and control and holds the changed readout's announcement, each as the app's tree and announcement give it.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FULL, REPO, TIMEOUT, blocked, exportOnce, none, obj, sha256, useShow, useTemp, webReceiptOf, type JsonValue } from '../172/helpers.ts';
import { AC, CHANGE_AT, appTree, playedFigure } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

const RECORD = join(dirname(fileURLToPath(import.meta.url)), 'VOICEOVER.json');
const BUNDLE = join(REPO, 'target', 'acceptance', '1045', 'voiceover');
/** The reference Macs by model identifier, as scripts/benchmark.mjs names them. */
const REFERENCE_MACS = ['Mac15,7', 'Mac15,12', 'Mac17,10'];
/** Letters and digits only, in lower case: what a transcript holds, whatever its punctuation and spacing. */
const words = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const text = (v: JsonValue | undefined): string => (typeof v === 'string' ? v.trim() : '');

describe(`${AC[2]} VoiceOver on Safari over the figure in the web player, on the reference Mac`, () => {
  it(`${AC[2]} a person's recorded VoiceOver run on this bundle names every part and control and hears the changed readout; without one the check is BLOCKED with one unblock ask, never PASS`, () => {
    const bin = shows(FULL);
    const app = appTree(bin, temp());
    mkdirSync(dirname(BUNDLE), { recursive: true });
    webReceiptOf(exportOnce(bin, temp(), playedFigure(), BUNDLE, "the figure's web export for the person's run"), "the figure's web export for the person's run");
    const bundle = sha256(readFileSync(join(BUNDLE, 'index.html')));
    const nodes = [...app.parts, ...app.controls];
    const folder = relative(REPO, BUNDLE);
    const ask = `Unblock: at a reference Mac (${REFERENCE_MACS.join(', ')}), serve ${folder}/ (python3 -m http.server 8045 --bind 127.0.0.1 --directory ${folder}), `
      + `open http://127.0.0.1:8045/ in Safari, turn VoiceOver on (Command-F5) with its caption panel, move VoiceOver through the player and write down `
      + `what it says for ${nodes.map((n) => `${n.id} ("${n.name}")`).join(', ')}; then set the player past ${CHANGE_AT} s (Safari's console: `
      + `document.querySelector('deep-player').currentTime = ${CHANGE_AT + 0.5}) and write down what VoiceOver announces; record the run in `
      + `tests/acceptance/1045/VOICEOVER.json with bundle ${bundle} (README: The VoiceOver run)`;
    if (!existsSync(RECORD)) blocked(`no person's VoiceOver run over this bundle (index.html ${bundle}) is recorded. ${ask}`);

    let raw: JsonValue;
    try { raw = JSON.parse(readFileSync(RECORD, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`VOICEOVER.json is not JSON: ${(e as Error).message}`); }
    const r = obj(raw, 'VOICEOVER.json');
    expect(r['issue'], 'VOICEOVER.json: issue').toBe(1045);
    expect(r['criterion'], 'VOICEOVER.json: criterion').toBe('#1045.acc208bf');
    expect(['pass', 'fail'], 'VOICEOVER.json: result').toContain(r['result']);
    for (const k of ['who', 'machine', 'macos', 'safari', 'bundle']) expect(text(r[k]), `VOICEOVER.json: ${k}, a non-empty string`).not.toBe('');
    const when = text(r['when']);
    expect(/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(when) && !Number.isNaN(Date.parse(when)), 'VOICEOVER.json: when, an ISO 8601 time').toBe(true);
    const by = `${text(r['who'])}, ${when}`;
    if (text(r['bundle']) !== bundle || !REFERENCE_MACS.includes(text(r['machine']))) {
      blocked(`the recorded VoiceOver run (${by}) was made on bundle ${text(r['bundle'])} at ${text(r['machine'])}, not on this bundle (index.html ${bundle}) at a reference Mac. ${ask}`);
    }
    if (r['result'] === 'fail') expect.fail(`the person's VoiceOver run (${by}) failed${text(r['note']) ? `: ${text(r['note'])}` : ''}`);

    const heard = obj(r['heard'], 'VOICEOVER.json: heard');
    const f: string[] = [];
    for (const n of nodes) {
      const said = text(heard[n.id]);
      if (!words(said).includes(words(n.name))) f.push(`what VoiceOver said for ${n.id} (${JSON.stringify(said)}) doesn't name it "${n.name}"`);
    }
    const announced = text(r['announced']);
    const change = app.announcement;
    if (!words(announced).includes(words(change.text))) f.push(`what VoiceOver announced (${JSON.stringify(announced)}) doesn't hold readout ${change.id}'s change, "${change.text}"`);
    none(f, `the person's VoiceOver run (${by})`);
    console.log(`${AC[2]}: VoiceOver run recorded by ${by} on bundle ${bundle}: passes`);
  }, TIMEOUT);
});
