// AC3 (#3172.f7060cf1): `acceptance_992_app` off macOS states INCONCLUSIVE for its platform, as its 18 neighbours do:
// it prints `acceptance_992_app: INCONCLUSIVE; <reason>`, the reason naming the platform it needs, and exits non-zero.
// The target's source is the one cargo metadata names for it; off macOS it is built by the machine's rustc alone, as
// its non-macOS branch needs only std (README: Real components and stand-ins).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, elsewhere, MINUTES, namesPlatform, run, sandbox } from './helpers.mjs';

const NAME = 'acceptance_992_app';

test('#3172.f7060cf1 acceptance_992_app off macOS prints "acceptance_992_app: INCONCLUSIVE; <reason naming its platform>" and exits non-zero, as its 18 neighbours do', MINUTES, async (t) => {
  if (process.platform === 'darwin') return t.skip(elsewhere('a machine off macOS, such as the Spark (Linux on aarch64)'));
  const box = sandbox(t);
  const meta = await run(['cargo', 'metadata', '--no-deps', '--format-version', '1', '--offline'], { cwd: CHECKOUT, env: box.env, box });
  assert.equal(meta.status, 0, `cargo metadata reads the workspace:\n${meta.output.slice(-2000)}`);
  const found = JSON.parse(meta.output.slice(meta.output.indexOf('{'))).packages.flatMap((pkg) => pkg.targets.filter((target) => target.name === NAME && target.kind.includes('test')).map((target) => ({ pkg, target })));
  assert.equal(found.length, 1, `the workspace has one test target ${NAME}`);
  const [{ pkg, target }] = found;
  assert.equal(pkg.name, 'deep-replica', `${NAME} is deep-replica's, as the issue names it`);
  const binary = join(box.dir, NAME);
  const built = await run(['rustc', '--edition', target.edition, '--crate-name', NAME, '--crate-type', 'bin', target.src_path, '-o', binary], { cwd: box.dir, env: box.env, box });
  assert.equal(built.status, 0, `rustc builds ${target.src_path} for ${process.platform}:\n${built.output}`);
  // As cargo test runs it: no case file set, nothing else asked of it.
  const env = { PATH: process.env.PATH, HOME: box.dir };
  const ran = await run([binary], { cwd: box.dir, env, box });
  const all = `${NAME} (exit ${ran.status}):\n${ran.output}`;
  assert.notEqual(ran.status, 0, `unrun is not passed: ${NAME} exits non-zero\n${all}`);
  const lines = ran.output.split('\n').filter((line) => line.startsWith(`${NAME}:`));
  assert.equal(lines.length, 1, `${NAME} prints one line of its state\n${all}`);
  const said = lines[0].match(/^acceptance_992_app: (\w+); (.+)$/);
  assert.ok(said, `the line is "${NAME}: <state>; <reason>"\n${all}`);
  assert.equal(said[1], 'INCONCLUSIVE', `${NAME} off macOS states INCONCLUSIVE, not ${said[1]}\n${all}`);
  // As its 18 neighbours' reasons do on the Spark (helpers.mjs, SPARK_TARGETS): "… macOS only, so nothing ran".
  assert.ok(namesPlatform(said[2]), `the reason names the platform it needs: "${said[2]}"\n${all}`);
});
