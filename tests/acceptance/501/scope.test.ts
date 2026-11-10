// AC3 #501.db25650c: "The export.target@1 kit exports a fixture holding a hidden item, a selected item and a session
// cutaway through every sealed target; each output is byte-identical to the export with no session state, the hidden
// item is handled as its target declares, and the document's revision hash and the session state are unchanged
// afterwards; a planted target that exports only the selection, or writes a baked channel back, fails, naming the
// target"
//
// Through `deep-show run` in the full build. The targets are export.target@1's entries in #200's `registries` listing,
// each declaring how it treats a hidden item (`hidden: "left_out" | "listed"`). The scope fixture (README: Fixtures)
// is exported through each target three times, each in its own scenario: with the session state set (`session`: `sel`
// selected and the cutaway's view input cutting through the scene), with no session state, and, for a target that
// leaves hidden items out, without the hidden item at all. This suite compares every file each export wrote, byte for
// byte (the criterion's own demand, not a frame comparison), and reads the revision hash (`revisions`) and the session
// state (`session`) before and after each export. The kit's own verdict is read from `kit` over the registry. Planted:
// `target_exports_selection` and `target_writes_baked_channel`, each in the png target's writer.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, SESSION_STATE, TIMEOUT, arr, failsNaming, filesUnder, none, obj, present, presented, runShow, scenario, scopeFilm, show,
  str, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const REGISTRY = 'export.target@1';

interface Target { name: string; hidden: string }
function sealedTargets(): Target[] {
  const [reply] = runShow(shows.bin(FULL), scenario(temp(), [{ call: 'registries' }]), 'the registries');
  const o = arr(reply!['registries'], 'registries').map((v, i) => obj(v, `registries[${i}]`)).find((x) => x['name'] === REGISTRY);
  expect(o, `deep://registries lists ${REGISTRY}`).toBeDefined();
  return arr(o!['entries'], `${REGISTRY}.entries`).map((e, i) => {
    const x = obj(e, `${REGISTRY}.entries[${i}]`);
    return { name: str(x['name'], `${REGISTRY}.entries[${i}].name`), hidden: str(x['hidden'], `${REGISTRY}.entries[${i}].hidden (left_out or listed)`) };
  });
}
/** The export call for a target: video as H.264, png as a PNG sequence, any other target by its own name as the codec
 * (Export: "or names an export target, as lottie and pdf do"). */
const video = (t: string): JsonObject => ({ codec: t === 'video' ? 'h264' : t === 'png' ? 'png_seq' : t });
const revisionHash = (reply: JsonObject, what: string): string => {
  const current = arr(reply['revisions'], `${what}: revisions`).map((r, i) => obj(r, `${what}: revisions[${i}]`)).filter((r) => r['state'] === 'current');
  expect(current.length, `${what}: one current revision`).toBe(1);
  return str(current[0]!['hash'], `${what}: the current revision's hash`);
};
const sessionOf = (reply: JsonObject, what: string): string => JSON.stringify(obj(reply['session'], `${what}: session`));

interface Run { files: Map<string, string>; receipts: Map<string, JsonObject>; failures: string[]; kit: JsonObject | null }
/** One scenario: the fixture presented, optionally the session state set, then each target's export into its own
 * folder; with the session, each export is followed by `revisions` and `session`, and the kit runs last. */
function exportAll(targets: Target[], opts: { session: boolean; ghost: boolean }, planted?: string): Run {
  const evidence = temp(); const dir = temp();
  const calls: JsonObject[] = [present(DOC.a, scopeFilm(opts.ghost))];
  if (opts.session) calls.push({ call: 'revisions', doc: DOC.a }, { call: 'session', doc: DOC.a, set: SESSION_STATE }, { call: 'session', doc: DOC.a });
  for (const t of targets) {
    calls.push({ call: 'export', doc: DOC.a, out: join(dir, t.name, 'out'), video: video(t.name) });
    if (opts.session) calls.push({ call: 'revisions', doc: DOC.a }, { call: 'session', doc: DOC.a });
  }
  if (opts.session) calls.push({ call: 'kit', registries: [REGISTRY] });
  const what = `the scope fixture${opts.session ? ' with session state' : ' with none'}${opts.ghost ? '' : ', without the hidden item'}`;
  const replies = runShow(shows.bin(FULL), scenario(evidence, calls), what, planted);
  presented(replies[0]!, what);
  const failures: string[] = [];
  let i = 1; let rev = ''; let state = '';
  if (opts.session) {
    rev = revisionHash(replies[i++]!, 'before the exports');
    i++;
    state = sessionOf(replies[i++]!, 'the session before the exports');
    expect(JSON.parse(state)['selection'], `the session holds the selection: ${state}`).toEqual(['sel']);
  }
  const files = new Map<string, string>(); const receipts = new Map<string, JsonObject>();
  for (const t of targets) {
    const reply = replies[i++]!;
    if (reply['outcome'] !== 'exported') failures.push(`${t.name}: the export isn't delivered: ${show(reply, 600)}`);
    else receipts.set(t.name, obj(reply['receipt'], `${t.name}: receipt`));
    const written = filesUnder(join(dir, t.name));
    if (written.length === 0) failures.push(`${t.name}: the export wrote no file`);
    files.set(t.name, JSON.stringify(written));
    if (opts.session) {
      const after = revisionHash(replies[i++]!, `after the ${t.name} export`);
      if (after !== rev) failures.push(`${t.name}: the document's revision hash changed from ${rev} to ${after}`);
      const s = sessionOf(replies[i++]!, `the session after the ${t.name} export`);
      if (s !== state) failures.push(`${t.name}: the session state changed from ${state} to ${s}`);
    }
  }
  return { files, receipts, failures, kit: opts.session ? replies[i]! : null };
}

/** The criterion over every sealed target: byte-identical to the export with no session state, the hidden item as the
 * target declares, the revision and the session unchanged. Every failure names its target. */
function scopeFailures(targets: Target[], planted?: string): string[] {
  const withSession = exportAll(targets, { session: true, ghost: true }, planted);
  const without = exportAll(targets, { session: false, ghost: true }, planted);
  const leftOut = targets.filter((t) => t.hidden === 'left_out');
  const noGhost = leftOut.length ? exportAll(leftOut, { session: false, ghost: false }, planted) : null;
  const failures = [...withSession.failures, ...without.failures, ...(noGhost?.failures ?? [])];
  for (const t of targets) {
    if (withSession.files.get(t.name) !== without.files.get(t.name)) failures.push(`${t.name}: the export with session state isn't byte-identical to the export with none: ${withSession.files.get(t.name)?.slice(0, 300)} vs ${without.files.get(t.name)?.slice(0, 300)}`);
    if (t.hidden === 'left_out') {
      if (without.files.get(t.name) !== noGhost!.files.get(t.name)) failures.push(`${t.name}: it declares hidden items left out, but its export differs from the export without the hidden item ghost`);
    } else if (t.hidden === 'listed') {
      const listed = without.receipts.get(t.name)?.['hidden'];
      if (!Array.isArray(listed) || !listed.includes('ghost')) failures.push(`${t.name}: it declares hidden items listed, but its receipt's hidden is ${show(listed)}`);
    } else failures.push(`${t.name}: it declares hidden: ${t.hidden}, neither left_out nor listed`);
  }
  const kit = obj(withSession.kit, 'kit');
  const report = arr(kit['registries'], 'kit: registries').map((r, i) => obj(r, `kit: registries[${i}]`)).find((r) => r['registry'] === REGISTRY);
  if (!report) failures.push(`kit: no report for ${REGISTRY}: ${show(kit, 600)}`);
  else {
    const entries = arr(report['entries'], 'kit: entries').map((e, i) => obj(e, `kit: entries[${i}]`));
    for (const t of targets) {
      const e = entries.find((x) => x['name'] === t.name);
      if (!e) failures.push(`kit: target ${t.name} has no case`);
      else if (e['verdict'] !== 'PASS') failures.push(`kit: target ${t.name} ${String(e['verdict'])}: ${show(e['failures'] ?? null, 400)}`);
    }
  }
  return failures;
}

describe(`${AC[3]} every export target exports the document as evaluated, with no session state, and changes nothing`, () => {
  it(`${AC[3]} through every sealed target the fixture with a hidden item, a selection and a session cutaway exports byte-identical to the export with no session state, the hidden item as declared, the revision hash and the session state unchanged, and the kit passes`, () => {
    const targets = sealedTargets();
    expect(targets.map((t) => t.name), 'the sealed targets include video and png').toEqual(expect.arrayContaining(['video', 'png']));
    none(scopeFailures(targets), 'the scope rule over every sealed target');
  }, 2 * TIMEOUT);

  it(`${AC[3]} a planted target that exports only the selection fails, naming the target`, () => {
    const failures = scopeFailures(sealedTargets(), 'target_exports_selection');
    failsNaming(failures, /^png: the export with session state isn't byte-identical/, 'the planted target (target_exports_selection), by this suite');
    failsNaming(failures, /^kit: target png FAIL/, 'the planted target (target_exports_selection), by the kit');
  }, 2 * TIMEOUT);

  it(`${AC[3]} a planted target that writes a baked channel back fails, naming the target`, () => {
    const failures = scopeFailures(sealedTargets(), 'target_writes_baked_channel');
    failsNaming(failures, /^png: the document's revision hash changed/, 'the planted target (target_writes_baked_channel), by this suite');
    failsNaming(failures, /^kit: target png FAIL/, 'the planted target (target_writes_baked_channel), by the kit');
  }, 2 * TIMEOUT);
});
