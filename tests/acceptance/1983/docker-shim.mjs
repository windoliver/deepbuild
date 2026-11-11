// The #1983 suite's stand-in at the container runtime's command line (README: Docker), first on the lane's PATH as
// `docker`. It writes each command line it is given to ACCEPTANCE_1983_DOCKER_LOG and runs it on the real CLI
// (ACCEPTANCE_1983_DOCKER), with two exceptions:
// - it refuses every pull, and logs it: `docker pull`, `docker image pull`, and a `run` or `create` of a hidden image
//   without `--pull never` (which the real runtime would pull);
// - with ACCEPTANCE_1983_HIDE (a JSON list of strings: the pinned image's digest, tag and IDs), it answers as a runtime
//   without that image: an inspect, history, save or tag of it has no such image, a run or create of it can't find it
//   locally, and an image listing leaves its lines out. The real runtime's images are never touched.
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const real = process.env.ACCEPTANCE_1983_DOCKER;
const log = process.env.ACCEPTANCE_1983_DOCKER_LOG;
const hide = JSON.parse(process.env.ACCEPTANCE_1983_HIDE || '[]');
const note = (event) => appendFileSync(log, `${JSON.stringify(event)}\n`);

// docker's own options come before the command; these take a value.
const WITH_VALUE = new Set(['--config', '-c', '--context', '-H', '--host', '-l', '--log-level', '--tlscacert', '--tlscert', '--tlskey']);
let i = 0;
while (i < args.length && args[i].startsWith('-')) i += WITH_VALUE.has(args[i]) ? 2 : 1;
const group = ['container', 'image', 'buildx', 'manifest', 'system'].includes(args[i]) ? args[i] : '';
const verb = (group ? args[i + 1] : args[i]) ?? '';
const rest = args.slice(i + (group ? 2 : 1));
const hidden = (a) => hide.some((token) => a.includes(token));
const ref = rest.find(hidden);

/** The exit status; output is written before the process ends by itself (a pipe on macOS is written asynchronously). */
function main() {
  note({ group, verb, rest });
  if (verb === 'pull' && (group === '' || group === 'image')) {
    note({ pull: rest });
    process.stderr.write('Error: the #1983 acceptance suite refuses every pull during a check\n');
    return 1;
  }
  if (ref !== undefined && ['run', 'create'].includes(verb) && (group === '' || group === 'container')) {
    const never = rest.some((a, k) => (a === '--pull' && rest[k + 1] === 'never') || a === '--pull=never');
    if (!never) note({ pull: [ref] });
    process.stderr.write(`Unable to find image '${ref}' locally\ndocker: Error response from daemon: No such image: ${ref}${never ? '' : ' (the #1983 acceptance suite refuses every pull during a check)'}\n`);
    return 125;
  }
  if (ref !== undefined && ['inspect', 'history', 'save', 'tag'].includes(verb) && (group === '' || group === 'image')) {
    process.stderr.write(`Error response from daemon: No such image: ${ref}\n`);
    return 1;
  }
  const listing = (group === '' && verb === 'images') || (group === 'image' && ['ls', 'list'].includes(verb));
  if (hide.length && listing) {
    const run = spawnSync(real, args, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
    process.stdout.write(run.stdout.split('\n').filter((line) => !hidden(line)).join('\n'));
    return run.status ?? 1;
  }
  return spawnSync(real, args, { stdio: 'inherit' }).status ?? 1;
}
process.exitCode = main();
