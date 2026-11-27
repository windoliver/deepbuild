// #3421 AC3: in a scratch checkout, lowering `exit`'s maximum to 100 in hook.reply@2.json and regenerating the Rust
// makes the hook refuse a reply with `exit` of 200, with no edit under crates/deep-hook/src.
//
// The scratch checkout is a copy of this checkout's Cargo workspace and contracts package (helpers.ts,
// scratchWithExitMaximum). There, and only there, the schema's maximum becomes 100, the repository's own command
// writes the Rust again (`npm run generate -w @deepbuild/contracts`), and `cargo build --locked -q -p deep-hook`
// builds the hook. A stand-in hub then acknowledges a call and replies with `exit` 200.
//
// Two controls come before the criterion's own line, so a hook that refuses every reply, or one the stand-in never
// reached in time, can't pass: nothing under crates/deep-hook/src differs from this checkout's, and the scratch hook
// still takes a reply with `exit` 100, the highest the edited schema allows.
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  ackLine, cleanup, exchangeInTime, filesUnder, HOOK_SRC, hubAway, loadNow, nonce, replyLine, replyOf, REPO, scratchWithExitMaximum, shown,
} from './helpers.ts';

afterEach(cleanup);

describe("#3421 AC3 the schema's bound reaches the hook by regenerating, with no edit to the hook", () => {
  test('#3421.bd1a37c9 with exit\'s maximum lowered to 100 in a scratch checkout and the Rust regenerated, the hook refuses a reply with exit of 200, with no edit under crates/deep-hook/src', async () => {
    const scratch = await scratchWithExitMaximum(100);
    expect(scratch.copied, 'the scratch checkout is made').toBe('');
    expect(scratch.schemaBefore?.properties?.exit?.maximum, "hook.reply@2.json holds exit's maximum as 255 before the edit").toBe(255);
    expect({ code: scratch.generate.code, timedOut: scratch.generate.timedOut }, `npm run generate -w @deepbuild/contracts runs in the scratch checkout: ${shown(scratch.generate)}`).toEqual({ code: 0, timedOut: false });
    expect(scratch.generatedChanged, 'regenerating writes the lowered maximum into crates/deep-contracts/src/generated.rs').toBe(true);
    expect([...filesUnder(join(scratch.dir, HOOK_SRC))], 'nothing under crates/deep-hook/src is edited: the scratch checkout holds this checkout\'s files, byte for byte')
      .toEqual([...filesUnder(join(REPO, HOOK_SRC))]);
    expect(scratch.build.error, 'the scratch checkout builds deep-hook: cargo build --locked -q -p deep-hook').toBe('');
    const bin = scratch.build.bin;

    const away = await hubAway(bin);
    expect(away.timedOut, `with no hub at the address the scratch hook answers by itself: ${shown(away)}`).toBe(false);

    // The control: exit 100 is within the lowered maximum, and its reply is taken.
    const within = nonce();
    const taken = await exchangeInTime(bin, away, (r) => [ackLine(r.id), replyLine(100, `out-${within}`, `err-${within}`)]);
    expect({ told: taken.told, reply: replyOf(taken.ran) }, `the scratch hook takes a reply with exit of 100 (${taken.tries} tries, load ${loadNow()}, last ${taken.how}): ${shown(taken.ran)}`)
      .toEqual({ told: true, reply: { exit: 100, stdout: `out-${within}`, stderr: `err-${within}` } });

    // The criterion: exit 200 is over it. The hook reads the reply as the hub away and prints none of its bytes.
    const over = nonce();
    const x = await exchangeInTime(bin, away, (r) => [ackLine(r.id), replyLine(200, `out-${over}`, `err-${over}`)]);
    const output = `${x.ran.stdout}\n${x.ran.stderr}`;
    expect(
      { told: x.told, how: x.how, exit: x.ran.code, stdout: x.ran.stdout, printed: [`out-${over}`, `err-${over}`].filter((text) => output.includes(text)) },
      `the scratch hook refuses a reply with exit of 200: it reads as the hub away (the exit code and stdout it gives with no hub, the request spooled with no late mark) and none of the reply's bytes is printed (${x.tries} tries, load ${loadNow()}): ${shown(x.ran)}`,
    ).toEqual({ told: true, how: 'refused', exit: away.code, stdout: away.stdout, printed: [] });
  }, 60 * 60_000);
});
