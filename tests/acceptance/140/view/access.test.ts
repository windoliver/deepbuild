// Criterion 4 (#140.94c6f71e): a fixture figure's accessibility tree is equal as data in the app and headless,
// and VoiceOver names every part and announces a changed readout.
//
// Headless: `deep-show run`'s `see` (#376), the tree as data. The app: `deep-show live` with `live.tree`, the
// tree read back from the real, shown window through NSAccessibility, as an assistive client reads it
// (README: The live options). The accessibility seam's macOS backend is GPUI's AccessKit tree, so a headless
// role is compared with the NSAccessibility role AccessKit gives it (README: Readings). The VoiceOver half needs
// a person at the reference Mac with VoiceOver on; it runs only with DEEP_140_LIVE=1 and is INCONCLUSIVE
// otherwise, never a pass or a skip.
import { spawn, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  DEEP_SHOW, FIGURE, FRAME, PANEL, SESSION, answers, arr, asAgent, clone, inconclusive, isObject, liveRun, obj, referenceMacProblem, replies,
  showScenario, str, useBuilds, useDir, type JsonObject, type JsonValue,
} from './helpers.ts';

const builds = useBuilds([DEEP_SHOW]);
const dir = useDir();

/** The NSAccessibility role AccessKit's macOS adapter gives each role `see` reports (README: Readings). */
const AX_ROLE: Record<string, string> = { part: 'AXImage', label: 'AXStaticText', data: 'AXStaticText', slider: 'AXSlider', switch: 'AXCheckBox' };

interface Row { id: string; role: string; name: string; value: string | null }
function rowsOf(tree: JsonValue | undefined, what: string): Row[] {
  return arr(tree, what).map((v, i) => {
    const r = obj(v, `${what}[${i}]`);
    const value = r['value'];
    return {
      id: str(r['id'], `${what}[${i}].id`), role: str(r['role'], `${what}[${i}].role`), name: str(r['name'], `${what}[${i}].name`),
      value: value === undefined || value === null ? null : String(value),
    };
  });
}

describe('#140.94c6f71e (C4) accessibility: the same tree as data in the app and headless, and a screen-reader smoke test', () => {
  it('#140.94c6f71e (C4) the figure\'s tree read from the app\'s window through NSAccessibility equals the headless tree, node for node: ID, role and name in reading order, and the readout\'s value', () => {
    const bin = builds.bin(DEEP_SHOW);
    const doc = FIGURE();
    const ids = new Set([...Object.keys(obj(doc['items'], 'items')), ...Object.keys(obj(doc['controls'], 'controls'))]);
    const [headless] = answers(bin, ['run'], [showScenario(dir(), doc, 'fig', {}, [{ call: 'see', panel: PANEL }])]);
    const see = rowsOf(obj(replies(headless!, 'deep-show run')[1], 'the see reply')['tree'], 'see: tree').filter((r) => ids.has(r.id));
    if (process.platform !== 'darwin') inconclusive('the app\'s accessibility tree is read on macOS only');
    const { live } = liveRun(bin, showScenario(dir(), doc, 'fig', { live: { tree: true } }));
    const app = rowsOf(live['tree'], 'live.tree').filter((r) => ids.has(r.id));

    const problems: string[] = [];
    for (const part of ['beam', 'lens', 'screen', 'rays', 'c-rays', 'c-labels']) {
      if (!see.some((r) => r.id === part)) problems.push(`the headless tree has no node for ${part}`);
      if (!app.some((r) => r.id === part)) problems.push(`the app's tree has no node for ${part}`);
    }
    const expected = see.map((r) => ({ id: r.id, role: AX_ROLE[r.role] ?? `(no NSAccessibility role for ${r.role})`, name: r.name }));
    const got = app.map((r) => ({ id: r.id, role: r.role, name: r.name }));
    if (JSON.stringify(got) !== JSON.stringify(expected)) problems.push(`the app's tree ${JSON.stringify(got)} is not the headless tree ${JSON.stringify(expected)}`);
    for (const r of see) {
      if (r.value === null) continue;
      const a = app.find((x) => x.id === r.id);
      if (a && a.value !== r.value) problems.push(`${r.id}'s value is ${JSON.stringify(a.value)} in the app and ${JSON.stringify(r.value)} headless`);
    }
    expect(problems, 'the accessibility tree, app against headless').toEqual([]);
  }, 900_000);

  it('#140.94c6f71e (C4) live, with a person: VoiceOver names every part and announces the readout when it changes from 3 to 4', async () => {
    if (process.env['DEEP_140_LIVE'] !== '1') inconclusive('the VoiceOver smoke test needs a person at the reference Mac with VoiceOver on; run with DEEP_140_LIVE=1 (README: The live runs)');
    const why = referenceMacProblem();
    if (why) inconclusive(why);
    const vo = (script: string): string | null => {
      const r = spawnSync('osascript', ['-e', `tell application "VoiceOver" to ${script}`], { encoding: 'utf8', timeout: 5000 });
      return r.status === 0 ? r.stdout.trim() : null;
    };
    const running = spawnSync('osascript', ['-e', 'tell application "System Events" to (name of processes) contains "VoiceOver"'], { encoding: 'utf8' });
    if (running.stdout.trim() !== 'true') inconclusive('VoiceOver is not on (⌘F5 turns it on)');
    if (vo('get content of last phrase') === null) inconclusive('VoiceOver does not answer AppleScript; turn on "Allow VoiceOver to be controlled with AppleScript" in VoiceOver Utility');

    const bin = builds.bin(DEEP_SHOW);
    const doc = FIGURE();
    const changed = clone(doc);
    obj(obj(changed['data'], 'data')['count'], 'data.count')['value'] = 4;
    const scenario = showScenario(dir(), doc, 'fig', {
      live: { hold_ms: 30_000, after: [{ after_ms: 15_000, call: { call: 'deep_show', session: SESSION, doc: 'fig', document: asAgent(changed), at: 20 * FRAME } }] },
    });
    const child = spawn(bin, ['live'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (b: Buffer) => { out += b.toString('utf8'); });
    child.stdin.end(`${JSON.stringify(scenario)}\n`);
    const done = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const heard: { at: number; phrase: string }[] = [];
    const began = Date.now();
    const listen = (): void => { const p = vo('get content of last phrase'); if (p && heard[heard.length - 1]?.phrase !== p) heard.push({ at: Date.now() - began, phrase: p }); };
    await sleep(2500);
    for (let i = 0; i < 16; i++) { vo('tell vo cursor to move right'); await sleep(500); listen(); }
    while (Date.now() - began < 28_000) { listen(); await sleep(150); }
    const code = await done;
    expect(code, `deep-show live exited 0; stdout: ${out.slice(0, 800)}`).toBe(0);
    const answer = JSON.parse(out.split('\n')[0] ?? '{}') as JsonValue;
    expect(isObject(answer) && answer['ok'], `deep-show live answered ok: ${out.slice(0, 800)}`).toBe(true);
    const items = obj(doc['items'], 'items');
    const parts = Object.values(items).filter((v): v is JsonObject => isObject(v) && v['role'] === 'part').map((v) => String(v['name']));
    const controls = Object.values(obj(doc['controls'], 'controls')).map((v) => String(obj(v, 'control')['label']));
    const said = heard.map((h) => h.phrase.toLowerCase());
    const f: string[] = [];
    for (const name of [...parts, ...controls]) if (!said.some((p) => p.includes(name.toLowerCase()))) f.push(`VoiceOver never named ${JSON.stringify(name)}`);
    if (!heard.some((h) => h.at >= 15_000 && /rays:\s*4/i.test(h.phrase))) f.push('VoiceOver did not announce the readout\'s change to "Rays: 4"');
    expect(f, `what VoiceOver said: ${JSON.stringify(heard)}`).toEqual([]);
  }, 120_000);
});
