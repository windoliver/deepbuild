// Issue #2134, criterion 1, written first and blind: a standing rule for one cloud account covers only a create that
// runs under that account. Every decision below is the real deep-hook's (`deep-hook claude-code PreToolUse`, Claude
// Code's payload for a Bash call on stdin) in a temp HOME whose rules.json is the shipped first-party entries plus the
// `standing` member the hub copies your standing rules into, with `~/.aws/config` naming profile `dev` and profile
// `prod`, and no hub: none is ever started. No command is ever run: each is a hook payload. The criterion is decided
// by the `expect`s here; controls and setup throw plain BLOCKED or INCONCLUSIVE errors (helpers.ts). README.md has
// the readings.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AC1, CLOUD_GUARD, DEV, PROD, buildDeepHook, cleanup, controls, decision, decisions, each, hook, makeHome, ownerOf, shown, words, wrong } from './helpers.ts';

const T = 300_000;
/** The issue's line: a run that creates nothing under the covered profile, then a create under the other one. */
const LINE = 'aws s3 ls --profile dev; aws kms create-key --profile prod';

beforeAll(buildDeepHook, 1_900_000);
afterEach(cleanup);

describe(`${AC1} a standing rule for one cloud account covers only a create that runs under that account`, () => {
  it(`${AC1} with a standing rule for profile dev's owner and no hub, \`${LINE}\` exits 2 with the ${CLOUD_GUARD} denial`, async () => {
    // Control: with no standing rule at all the line is denied, so the entry holds it and only the rule can let it go.
    const bare = await hook(makeHome(), LINE);
    if (decision(bare) !== 'denied') throw Error(`BLOCKED: control: with no standing rule and no hub, \`${LINE}\` must exit 2 with the ${CLOUD_GUARD} denial: ${shown(bare)}`);
    const h = makeHome({ standing: [ownerOf(DEV)] });
    await controls(h);
    const r = await hook(h, LINE);
    expect(r.code, `the key is created under profile ${PROD.profile}, which no standing rule covers, so the call must exit 2: ${shown(r)}`).toBe(2);
    expect(words(r), `the denial must be ${CLOUD_GUARD}'s: ${shown(r)}`).toContain(CLOUD_GUARD);
  }, T);

  it(`${AC1} scope: the same two runs, joined or spelled another way, are denied the same`, async () => {
    const h = makeHome({ standing: [ownerOf(DEV)] });
    await controls(h);
    const lines = [
      'aws s3 ls --profile dev ; aws kms create-key --profile prod',
      'aws s3 ls --profile dev && aws kms create-key --profile prod',
      'aws s3 ls --profile dev\naws kms create-key --profile prod',
      'aws --profile dev s3 ls && aws --profile prod kms create-key',
      'aws s3 ls --profile=dev && aws kms create-key --profile=prod',
    ];
    const off = wrong(await decisions(h, lines), each(lines, 'denied'));
    expect(off, `each line creates its key under profile ${PROD.profile}, which no standing rule covers, so each must exit 2 with the ${CLOUD_GUARD} denial: ${off.join('; ')}`).toEqual([]);
  }, T);

  it(`${AC1} scope: the owner is read from the creating run, so a create under the covered profile is still covered beside a run under another`, async () => {
    const h = makeHome({ standing: [ownerOf(DEV)] });
    await controls(h);
    const lines = [
      'aws s3 ls --profile prod && aws kms create-key --profile dev',
      'aws s3 ls --profile prod; aws kms create-key --profile dev',
      'aws kms create-key --profile dev; aws s3 ls --profile prod',
      'echo --profile prod && aws kms create-key --profile dev',
    ];
    const off = wrong(await decisions(h, lines), each(lines, 'allowed'));
    expect(off, `each line's one creating run is under profile ${DEV.profile}, whose owner the standing rule covers, so each must be allowed: ${off.join('; ')}`).toEqual([]);
  }, T);

  it(`${AC1} scope: AWS_PROFILE in the creating run's own environment names its owner`, async () => {
    // The default profile signs into the covered account, so a reading that passes over AWS_PROFILE covers this create.
    const a = makeHome({ standing: [ownerOf(DEV)], defaultIs: DEV });
    await controls(a);
    const plain = await hook(a, 'aws kms create-key');
    if (decision(plain) !== 'allowed') throw Error(`BLOCKED: control: with the default profile signing into the covered account, \`aws kms create-key\` must be allowed: ${shown(plain)}`);
    // No default profile: only AWS_PROFILE names the covered account.
    const b = makeHome({ standing: [ownerOf(DEV)] });
    await controls(b);
    const under = (profile: string) => `AWS_PROFILE=${profile} aws kms create-key`;
    const got = {
      [`default profile covered: ${under(PROD.profile)}`]: decision(await hook(a, under(PROD.profile))),
      [`no default profile: ${under(DEV.profile)}`]: decision(await hook(b, under(DEV.profile))),
      [`no default profile: ${under(PROD.profile)}`]: decision(await hook(b, under(PROD.profile))),
    };
    const off = wrong(got, {
      [`default profile covered: ${under(PROD.profile)}`]: 'denied',
      [`no default profile: ${under(DEV.profile)}`]: 'allowed',
      [`no default profile: ${under(PROD.profile)}`]: 'denied',
    });
    expect(off, `the standing rule covers profile ${DEV.profile}'s owner only, and each run names its profile by AWS_PROFILE: ${off.join('; ')}`).toEqual([]);
  }, T);

  it(`${AC1} scope: a line with more than one creating run, or creating runs under different owners, is not covered`, async () => {
    const h = makeHome({ standing: [ownerOf(DEV)] });
    await controls(h);
    const lines = [
      'aws kms create-key --profile dev && aws kms create-key --profile dev',
      'aws kms create-key --profile dev && aws kms create-key --profile prod',
      'aws kms create-key --profile dev && pulumi up',
    ];
    const off = wrong(await decisions(h, lines), each(lines, 'denied'));
    expect(off, `each line holds two creating runs, so each must exit 2 with the ${CLOUD_GUARD} denial: ${off.join('; ')}`).toEqual([]);
  }, T);
});
