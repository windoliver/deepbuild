// AC5: A person's direct push to the default branch reads unguarded in the record, and no claim reads PASS from it.
//
// With DeepBuild's rules on the forge, maya pushes a commit straight to main, through the forge's bypass for her, while
// a session works in the repo (#46 reads a repo's pushes while one does). The record must hold it as `ref.unguarded`
// (#46's kind), naming main, the commit and maya; and nothing reads PASS from it: no verdict.made PASS on that commit,
// and no green deepbuild/verdict status on it, in the 30 s after it is recorded.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { AC, CONTEXT, DEFAULT_BRANCH, must, PERSON, sleep, waitFor, World } from './helpers.ts';

const READ_WAIT = 90_000;

describe(`${AC[5]} A person's direct push to the default branch reads unguarded, and never PASS`, () => {
  it(`${AC[5]} maya's push to ${DEFAULT_BRANCH} through the forge's bypass is recorded unguarded, and no claim or status reads PASS from it`, async () => {
    const w = await World.open();
    await w.applyRules();
    await w.liveSession(w.repo);
    await w.personGit('checkout', '-q', DEFAULT_BRANCH);
    writeFileSync(join(w.repo, 'README.md'), '# shop\n\nOpen on Sundays.\n');
    await w.personGit('commit', '-q', '-am', 'Open on Sundays');
    const sha = await w.personGit('rev-parse', 'HEAD');
    const pushed = await w.personGit('push', '-q', 'origin', `HEAD:refs/heads/${DEFAULT_BRANCH}`).then(() => '', (error: Error) => error.message);
    must(!pushed, `maya's direct push to ${DEFAULT_BRANCH} was refused, so a person can't land by hand through the forge's bypass: ${pushed}`);
    const unguarded = await waitFor(async () => (await w.events('ref.unguarded')).find((e) => e.data?.ref === `refs/heads/${DEFAULT_BRANCH}` && e.data?.commit === sha), READ_WAIT, 'ref.unguarded', 500)
      .catch(() => undefined);
    must(unguarded !== undefined, `maya's direct push of ${sha} to ${DEFAULT_BRANCH} is not recorded as unguarded within ${READ_WAIT / 1000} s`);
    must(unguarded.data?.pusher === PERSON, `the unguarded record names maya as the pusher: ${JSON.stringify(unguarded.data)}`);
    await sleep(30_000);
    const pass = (await w.events('verdict.made')).filter((e) => e.data?.commit === sha && e.data?.outcome === 'PASS');
    must(!pass.length, `a claim reads PASS from maya's direct push of ${sha}: ${JSON.stringify(pass.map((e) => e.data?.claim))}`);
    const green = w.forge.statusesOf(sha).filter((s) => s.context === CONTEXT && s.state === 'success');
    must(!green.length, `maya's direct push of ${sha} holds a green ${CONTEXT} from ${green.map((s) => s.creator).join(', ')}`);
  }, 600_000);
});
