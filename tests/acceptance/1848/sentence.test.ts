// #1848 AC3: only an argument that reads as a path counts. `mcp__files__write_file` whose path is `<repo>/src/a.ts`
// runs, and the same write whose `content` is a sentence that mentions `.deepbuild/done.yaml` isn't denied for it,
// through the hook path and `deep-hook match`. With no hub at the address, so deep-hook's reader alone decides. A
// reader that counts every string argument as a path (cargo feature plant-every-string-a-path) denies the sentence's
// call by no-deepbuild-spec-write and fails this test, naming the argument. On the merge base the reader counts no MCP
// argument, so the first test passes there and the wrong program's build fails (BASE-FAILURE.txt).
import { afterEach, beforeAll, describe, it } from 'vitest';
import {
  AC3, PLANT, SPEC, buildDeepHook, cleanup, decision, denialText, failureOf, files, hook, label, makeWorld, matched,
  must, shown,
} from './helpers.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

/**
 * A sentence, with spaces, that mentions the spec file. Read whole as a path relative to the call's cwd, or word by
 * word, it lies under `<repo>/.deepbuild/`, so a reader that counts it as a path meets no-deepbuild-spec-write.
 */
const SENTENCE = '.deepbuild/done.yaml holds the definition of done; this note only mentions it.';

async function judgeAC3(binary: string): Promise<void> {
  const who = `AC3 ${AC3}`;
  const w = makeWorld();
  const plain = files('write_file', { path: `${w.repo}/src/a.ts`, content: 'export const a = 1;\n' });
  const note = files('write_file', { path: `${w.repo}/src/a.ts`, content: SENTENCE });
  const r1 = await hook(w, plain, binary);
  must(decision(r1) === 'allow', `${who} ${label(plain)} must run: deep-hook ${decision(r1) === 'deny' ? 'denied' : 'didn\'t allow'} it (${shown(r1)})`, r1);
  const r2 = await hook(w, note, binary);
  must(decision(r2) === 'allow', `${who} the argument content, a sentence that mentions .deepbuild/done.yaml, isn't a path: ${label(note)} must run as the same write with plain content does, and deep-hook ${decision(r2) === 'deny' ? 'denied it for it' : 'didn\'t allow it'} (${shown(r2)})`, r2);
  const replies = await matched(w, [plain, note], binary);
  for (const [i, call] of [plain, note].entries()) {
    const m = replies[i]!;
    must(Array.isArray(m.denials) && m.denials.length === 0 && !(m.matched ?? []).includes(SPEC), `${who} deep-hook match must read ${label(call)} as the hook path does, with no denial: ${JSON.stringify(m)}`);
  }
}

describe(`AC3 ${AC3} a path argument counts; a sentence in content doesn't`, () => {
  it(`AC3 ${AC3} mcp__files__write_file whose path is <repo>/src/a.ts runs, and the same write whose content is a sentence mentioning .deepbuild/done.yaml isn't denied for it`, async () => {
    await judgeAC3(BIN);
  }, 600_000);

  it(`AC3 ${AC3} (wrong program) a reader that counts every string as a path (${PLANT}) denies the sentence's call by ${SPEC}, naming the argument content, and fails this test`, async () => {
    const plant = await buildDeepHook(PLANT);
    const failed = await failureOf(() => judgeAC3(plant));
    must(failed !== null, `${PLANT}: AC3's test must fail on a reader that counts every string as a path; it passed`);
    must(failed.message.includes('the argument content'), `${PLANT}: AC3's test must fail at the call whose content is the sentence, naming the argument content: ${failed.message}`);
    const denial = failed.ran ? denialText(failed.ran) : '';
    must(denial.includes(SPEC) && /(^|[^A-Za-z0-9_])content([^A-Za-z0-9_]|$)/.test(denial), `${PLANT}: the planted reader's denial must be ${SPEC}'s, naming the argument content: ${denial}`);
  }, 900_000);
});
