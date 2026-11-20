// cargo, stood in at its boundary for #2818's tests (README: Surface choices). `metadata` lists each crate whose
// crates/<name>/Cargo.toml the folder holds, with one lib target. `test` prints a run of each crate's two unit tests,
// `tests::passes` and `tests::fails_on_main`, as cargo prints one (its own lines on stderr, the harness's on stdout),
// narrowed by `-p` and by a name after `--`, and exits 101 when one failed. Every other command does nothing.
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const root = realpathSync(process.cwd());
const names = existsSync(join(root, 'crates')) ? readdirSync(join(root, 'crates')).filter((name) => existsSync(join(root, 'crates', name, 'Cargo.toml'))).sort() : [];

if (args[0] === 'metadata') {
  const packages = names.map((name) => ({
    name, version: '0.1.0', id: `path+file://${join(root, 'crates', name)}#${name}@0.1.0`, manifest_path: join(root, 'crates', name, 'Cargo.toml'), dependencies: [],
    targets: [{ name: name.replaceAll('-', '_'), kind: ['lib'], crate_types: ['lib'], src_path: join(root, 'crates', name, 'src', 'lib.rs'), test: true, doctest: false }],
  }));
  console.log(JSON.stringify({ packages, workspace_members: packages.map(({ id }) => id), workspace_root: root, target_directory: join(root, 'target'), version: 1 }));
  process.exit(0);
}
if (args[0] !== 'test') process.exit(0);

const end = args.indexOf('--');
const own = end < 0 ? args : args.slice(0, end), harness = end < 0 ? [] : args.slice(end + 1);
const picked = own.flatMap((arg, at) => (['-p', '--package'].includes(own[at - 1]) ? [arg] : arg.startsWith('--package=') ? [arg.slice(10)] : []));
const filters = harness.filter((arg) => !arg.startsWith('-'));
const exact = harness.includes('--exact');
const chosen = (test) => !filters.length || filters.some((filter) => (exact ? test === filter : test.includes(filter)));
const failed = [];
for (const name of picked.length ? names.filter((one) => picked.includes(one)) : names) {
  const tests = [['tests::passes', 'ok'], ['tests::fails_on_main', 'FAILED']].filter(([test]) => chosen(test));
  const bad = tests.filter(([, result]) => result === 'FAILED');
  process.stderr.write(`   Compiling ${name} v0.1.0 (${join(root, 'crates', name)})\n    Finished \`test\` profile [unoptimized + debuginfo] target(s) in 0.02s\n     Running unittests src/lib.rs (target/debug/deps/${name.replaceAll('-', '_')}-0123456789abcdef)\n`);
  let out = `\nrunning ${tests.length} test${tests.length === 1 ? '' : 's'}\n${tests.map(([test, result]) => `test ${test} ... ${result}\n`).join('')}`;
  if (bad.length) {
    out += `\nfailures:\n\n---- tests::fails_on_main stdout ----\n\nthread 'tests::fails_on_main' panicked at crates/${name}/src/lib.rs:6:26:\nassertion \`left == right\` failed\n  left: 1\n right: 2\nnote: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace\n\n\nfailures:\n    tests::fails_on_main\n`;
  }
  out += `\ntest result: ${bad.length ? 'FAILED' : 'ok'}. ${tests.length - bad.length} passed; ${bad.length} failed; 0 ignored; 0 measured; ${2 - tests.length} filtered out; finished in 0.00s\n\n`;
  process.stdout.write(out);
  if (bad.length) failed.push(name);
}
if (!failed.length) process.exit(0);
process.stderr.write(own.includes('--no-fail-fast')
  ? `error: ${failed.length} target${failed.length === 1 ? '' : 's'} failed:\n${failed.map((name) => `    \`-p ${name} --lib\`\n`).join('')}`
  : `error: test failed, to rerun pass \`-p ${failed[0]} --lib\`\n`);
process.exit(101);
