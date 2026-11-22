// Issue #2134, criterion 2, written first and blind: an option's value before the subcommand is never read as the
// subcommand, for pulumi, cdk and npm as for aws, docker and gh. The matcher is the real deep-hook's, asked through
// its check mode (`deep-hook check`: a guard@1 entry and a Bash call on stdin, whether the entry matches), the way
// the hub runs it at install; the last test reads the same through the hook's decision with the hub away
// (`deep-hook claude-code PreToolUse`, the shipped first-party entries, no hub). No command is ever run. The criterion
// is decided by the `expect`s here; controls and setup throw plain BLOCKED or INCONCLUSIVE errors (helpers.ts).
// README.md has the readings.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AC2, CLOUD, CLOUD_GUARD, DEPENDENCY, buildDeepHook, cleanup, decision, decisions, each, hook, makeHome, matched, matches, shown, wrong, type Home } from './helpers.ts';

const T = 300_000;

beforeAll(buildDeepHook, 1_900_000);
afterEach(cleanup);

/** Control: the plain spellings match as they do at the base, so check mode reads these tools at all. */
async function plainOnesMatch(h: Home): Promise<void> {
  for (const [command, pattern] of [['pulumi up', CLOUD], ['cdk deploy', CLOUD], ['npm install left-pad', DEPENDENCY]] as const) {
    if (!(await matched(h, command, pattern))) throw Error(`BLOCKED: control: ${pattern} must match \`${command}\`, as at the base`);
  }
  for (const [command, pattern] of [['pulumi preview', CLOUD], ['cdk diff', CLOUD], ['npm run build', DEPENDENCY]] as const) {
    if (await matched(h, command, pattern)) throw Error(`BLOCKED: control: ${pattern} must not match \`${command}\`, as at the base`);
  }
}

describe(`${AC2} an option's value before the subcommand is never read as the subcommand, for pulumi, cdk and npm`, () => {
  it(`${AC2} \`pulumi -C infra up\` and \`cdk --profile prod deploy\` match effect:cloud-resource, and \`npm --prefix web install left-pad\` matches effect:dependency`, async () => {
    const h = makeHome();
    await plainOnesMatch(h);
    const got = {
      'pulumi -C infra up': await matched(h, 'pulumi -C infra up', CLOUD),
      'cdk --profile prod deploy': await matched(h, 'cdk --profile prod deploy', CLOUD),
      'npm --prefix web install left-pad': await matched(h, 'npm --prefix web install left-pad', DEPENDENCY),
    };
    const off = wrong(got, { 'pulumi -C infra up': true, 'cdk --profile prod deploy': true, 'npm --prefix web install left-pad': true });
    expect(off, `each must match (matched: true): ${off.join('; ')}`).toEqual([]);
  }, T);

  it(`${AC2} an option's value that spells a subcommand is not read as one, and a run that creates or installs nothing still matches nothing`, async () => {
    const h = makeHome();
    await plainOnesMatch(h);
    const cloud = ['pulumi -C up preview', 'pulumi --cwd up preview', 'cdk --profile deploy diff', 'cdk --app deploy diff', 'pulumi -C infra preview', 'cdk --profile prod diff'];
    const dependency = ['npm -C install run build', 'pnpm -C install run build', 'bun -C install run build', 'npm --prefix install run build', 'npm --prefix web run build'];
    const off = [...wrong(await matches(h, cloud, CLOUD), each(cloud, false)), ...wrong(await matches(h, dependency, DEPENDENCY), each(dependency, false))];
    expect(off, `none creates a cloud resource or adds a dependency, so none must match (matched: false): ${off.join('; ')}`).toEqual([]);
  }, T);

  it(`${AC2} scope: each of pulumi's and cdk's valued options before the subcommand leaves the create matched`, async () => {
    const h = makeHome();
    await plainOnesMatch(h);
    const lines = [
      ...['-C infra', '--cwd infra', '-s dev', '--stack dev', '--color always'].map((o) => `pulumi ${o} up`),
      ...['--profile prod', '--app app.js', '-a app.js', '-o out', '--output out', '-c stage=prod', '--context stage=prod'].map((o) => `cdk ${o} deploy`),
    ];
    const off = wrong(await matches(h, lines, CLOUD), each(lines, true));
    expect(off, `each must match ${CLOUD} (matched: true): ${off.join('; ')}`).toEqual([]);
  }, T);

  it(`${AC2} scope: each of npm's, pnpm's and bun's valued options before the subcommand leaves the install matched`, async () => {
    const h = makeHome();
    await plainOnesMatch(h);
    const lines = ['npm', 'pnpm', 'bun'].flatMap((tool) => ['--prefix web', '-C web', '-w web', '--workspace web'].map((o) => `${tool} ${o} install left-pad`));
    const off = wrong(await matches(h, lines, DEPENDENCY), each(lines, true));
    expect(off, `each must match ${DEPENDENCY} (matched: true): ${off.join('; ')}`).toEqual([]);
  }, T);

  it(`${AC2} with the first-party entries and no hub, \`pulumi -C infra up\` and \`cdk --profile prod deploy\` exit 2 with the ${CLOUD_GUARD} denial`, async () => {
    const h = makeHome();
    // Controls: with the hub away the entry denies the plain create, and a run that creates nothing is allowed.
    const plain = await hook(h, 'pulumi up');
    if (decision(plain) !== 'denied') throw Error(`BLOCKED: control: with no hub, \`pulumi up\` must exit 2 with the ${CLOUD_GUARD} denial: ${shown(plain)}`);
    const preview = await hook(h, 'pulumi -C infra preview');
    if (decision(preview) !== 'allowed') throw Error(`BLOCKED: control: with no hub, \`pulumi -C infra preview\` must be allowed: ${shown(preview)}`);
    const lines = ['pulumi -C infra up', 'cdk --profile prod deploy'];
    const off = wrong(await decisions(h, lines), each(lines, 'denied'));
    expect(off, `each must exit 2 with the ${CLOUD_GUARD} denial: ${off.join('; ')}`).toEqual([]);
  }, T);
});
