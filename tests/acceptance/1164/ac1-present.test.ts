// AC1 #1164.29c6a1db: "The piece is presented with no issues and its program reaches the engine only as sandbox@1's
// rewritten bytes; the same piece with a program that imports a function is refused at check with sandbox@1's report
// naming `rules`, and the last good revision stays shown"
//
// asserts: `deep show --check` from the test process presents the game with `issues: []`; deep_query's logic read
// names, as `hash` (chosen), the SHA-256 of the bytes the engine runs, which is `deep-sandbox rewrite`'s hash of the
// program in the role logic and not the built program's SHA-256. The same piece naming the `imports_function` build
// (its step calls `env.note`) is not presented: an error naming the item `rules` carries `refusals` equal, refusal
// for refusal, to `deep-sandbox check`'s for those bytes in the role logic; the current revision's hash is the good
// one's before and after. Wrong program: the `imports_function` build, judged as the piece: AC1's judgement fails it,
// naming the criterion and `rules`.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  AC, REPO, Script, TIMEOUT, arr, currentHash, failsNaming, findAll, game, isObject, issuesOf, keepProof, namesItem, none, obj, prebuild,
  program, putEvidence, revisionsCall, runShow, sandboxBin, same, scenario, show, showBin, showCall, useDir, queryCall, type JsonObject,
} from './helpers.ts';

prebuild(() => { showBin(); sandboxBin(); program('rules'); program('imports_function'); });
const dir = useDir();

/** sandbox@1's runner (#238): JSON lines in, one reply per line. */
function onSandbox(calls: JsonObject[]): JsonObject[] {
  const r = spawnSync(sandboxBin(), [], { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL' });
  expect(r.status, `deep-sandbox exits 0: ${(r.stderr ?? '').slice(-800)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-sandbox: one reply per call').toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonObject, `deep-sandbox reply ${i}`));
}

/** AC1's judgement of a presentation: presented with no issues, and deep_query's `hash` is sandbox@1's rewrite of the program. */
function judge(shown: JsonObject, query: JsonObject, rewrite: JsonObject, sha: string): string[] {
  const out: string[] = [];
  const issues = issuesOf(shown);
  if (shown['outcome'] !== 'presented') out.push(`${AC[1]} item rules: the piece isn't presented (outcome ${show(shown['outcome'])}): ${show(shown['issues'] ?? shown, 1200)}`);
  else if (issues.length) out.push(`${AC[1]} the piece is presented with issues: ${show(shown['issues'], 1200)}`);
  const logic = isObject(query['logic']) && isObject(query['logic']['rules']) ? query['logic']['rules'] : null;
  const hash = logic?.['hash'];
  if (rewrite['ok'] !== true) out.push(`${AC[1]} item rules: sandbox@1 doesn't rewrite its program in the role logic: ${show(rewrite, 600)}`);
  else if (typeof hash !== 'string') out.push(`${AC[1]} item rules: deep_query names no hash of the bytes the engine runs: ${show(query, 600)}`);
  else {
    if (hash !== rewrite['hash']) out.push(`${AC[1]} item rules: the engine runs bytes hashing ${hash}, not sandbox@1's rewrite ${show(rewrite['hash'])}`);
    if (hash === sha) out.push(`${AC[1]} item rules: the engine runs the program as built (${sha})`);
  }
  return out;
}

describe(`${AC[1]} presented, run only as sandbox@1's rewrite, and a program importing a function refused`, () => {
  it(`${AC[1]} the piece is presented with no issues and runs as sandbox@1's rewritten bytes; the importing program is refused with sandbox@1's report naming rules, and the last good revision stays shown`, () => {
    const good = program('rules');
    const imp = program('imports_function');
    putEvidence(dir(), good.bytes);
    putEvidence(dir(), imp.bytes);
    const s = new Script(game(good.sha), { play: false });
    const before = s.add(revisionsCall);
    const query = s.add((at) => queryCall(at, [0]));
    const refused = s.add((at) => showCall(game(imp.sha), at));
    const after = s.add(revisionsCall);
    const r = runShow(scenario(dir(), s.calls, { headless: true }), 'AC1: the good piece, then the piece importing a function');
    const [rewrite, check] = onSandbox([{ call: 'rewrite', program: good.b64, role: 'logic' }, { call: 'check', program: imp.b64, role: 'logic' }]);
    keepProof('ac1-replies.json', { replies: r, sandbox: [rewrite, check] });
    none(judge(r[0]!, r[query]!, rewrite!, good.sha), 'AC1: the good piece');

    // sandbox@1's own report on the importing program, and the hub's refusal carrying it.
    expect(check!['code'], `deep-sandbox refuses the importing program in the role logic: ${show(check)}`).toBe('subset_refused');
    const report = arr(check!['refusals'] ?? null, 'deep-sandbox: refusals');
    expect(show(report).includes('note'), `sandbox@1's report names the import env.note: ${show(report)}`).toBe(true);
    const no = r[refused]!;
    expect(no['outcome'], `the piece importing a function is refused at check, not presented: ${show(no, 1500)}`).not.toBe('presented');
    const naming = issuesOf(no).filter((i) => i.severity === 'error' && namesItem(i.raw, 'rules'));
    expect(naming.length, `an error names the item rules: ${show(no['issues'] ?? no, 1500)}`).toBeGreaterThan(0);
    expect(naming.some((i) => findAll(i.raw, 'refusals').some((x) => same(x, report))), `the error naming rules carries sandbox@1's report ${show(report)}: ${show(naming.map((i) => i.raw), 1500)}`).toBe(true);
    const good0 = currentHash(r[before]!, 'AC1: before the importing revision');
    expect(currentHash(r[after]!, 'AC1: after the importing revision'), 'the last good revision stays shown').toBe(good0);
  }, TIMEOUT);

  it(`${AC[1]} wrong program: the rules program built to import a function (imports_function) fails AC1's judgement, naming the criterion and rules`, () => {
    const good = program('rules');
    const imp = program('imports_function');
    putEvidence(dir(), good.bytes);
    putEvidence(dir(), imp.bytes);
    const legs = [good, imp].map((p) => {
      const s = new Script(game(p.sha), { play: false });
      const q = s.add((at) => queryCall(at, [0]));
      const r = runShow(scenario(dir(), s.calls, { headless: true }), `AC1: the piece with ${p.name}`);
      const [rewrite] = onSandbox([{ call: 'rewrite', program: p.b64, role: 'logic' }]);
      return judge(r[0]!, r[q]!, rewrite!, p.sha);
    });
    none(legs[0]!, 'AC1: the real program passes the judgement first');
    failsNaming(legs[1]!, AC[1], [/\brules\b/], 'AC1: the program that imports a function');
  }, TIMEOUT);
});
