// The service manager's stand-in for #3438's acceptance tests (README: Stand-ins). A test writes a two-line `launchctl`
// that runs this file with a state folder, and puts it first on a child's PATH: `node launchctl.mjs <state> <launchctl's
// own arguments>`. Nothing here reaches the real launchd and nothing is ever started: a loaded job is an entry of
// `<state>/jobs.json`, so a job this stand-in loaded never runs, and a run that waits for its hub waits in vain.
//
//   <state>/mode         `accept`: bootstrap loads a job; anything else, or no file: every load is refused
//   <state>/calls.jsonl  one line a call: its arguments, its exit code, and for a load the definition it was handed
//   <state>/plist-<n>    the definition a load was handed, copied as it was at that moment
//   <state>/jobs.json    the jobs loaded now, by label: the domain and the path each was loaded from
//
// It answers as launchd does where the tests' programs read the answer: a load of a loaded label, or a refused one,
// says `Bootstrap failed: 5: Input/output error` and exits 5; a job that isn't loaded is `Could not find service`, exit
// 113, or `Boot-out failed: 3: No such process`, exit 3; `print` of a loaded job names its `path`.
import { appendFileSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [state, verb = '', ...rest] = process.argv.slice(2);
const read = (name, otherwise) => { try { return readFileSync(join(state, name), 'utf8'); } catch { return otherwise; } };
const real = (path) => { try { return realpathSync(path); } catch { return path; } };
const accepts = read('mode', '').trim() === 'accept';
const jobs = JSON.parse(read('jobs.json', '{}'));
const call = { argv: [verb, ...rest] };

/** Logs the call with its exit code, says `said` (on stderr when the call failed), and ends. */
function end(code, said = '') {
  appendFileSync(join(state, 'calls.jsonl'), `${JSON.stringify({ ...call, exit: code })}\n`);
  if (said) (code ? process.stderr : process.stdout).write(`${said}\n`);
  process.exit(code);
}
const keep = () => writeFileSync(join(state, 'jobs.json'), `${JSON.stringify(jobs)}\n`);
/** `gui/501/com.example.job` as its domain and its label; a domain alone has no label. */
function target(text = '') {
  const [, domain, label] = /^([a-z]+\/\d+)(?:\/(.*))?$/.exec(text) ?? [];
  return { domain: domain ?? text, label: label || undefined };
}
const plain = (args) => args.filter((arg) => !arg.startsWith('-'));
const notFound = (label, domain) => `Bad request.\nCould not find service "${label ?? ''}" in domain for ${domain}`;

/** Loads each definition into `domain`: the copy and the label are logged whatever the answer. */
function load(domain, paths) {
  if (!paths.length) end(64, 'Usage: launchctl bootstrap <domain-target> [service-path, service-path2, ...]');
  for (const path of paths) {
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      call.loads = [...call.loads ?? [], { domain, path, label: null, copy: null }];
      end(5, `${path}: No such file or directory\nBootstrap failed: 5: Input/output error`);
    }
    const label = /<key>Label<\/key>\s*<string>([^<]*)<\/string>/.exec(text)?.[1] ?? null;
    const copy = `plist-${readdirSync(state).filter((name) => name.startsWith('plist-')).length + 1}`;
    writeFileSync(join(state, copy), text);
    call.loads = [...call.loads ?? [], { domain, path, label, copy }];
    if (!accepts || !label || jobs[label]) end(5, 'Bootstrap failed: 5: Input/output error');
    jobs[label] = { domain, path };
    keep();
  }
  end(0);
}
/** Removes the loaded jobs `labels` names. */
function unload(labels) {
  if (!labels.length) end(3, 'Boot-out failed: 3: No such process');
  for (const label of labels) delete jobs[label];
  keep();
  end(0);
}
const loadedFrom = (paths) => Object.keys(jobs).filter((label) => paths.some((path) => real(path) === real(jobs[label].path)));

switch (verb) {
  case 'bootstrap':
    load(target(rest[0]).domain, rest.slice(1));
    break;
  case 'load':
    load(null, plain(rest));
    break;
  case 'bootout': {
    const { label } = target(rest[0]);
    unload(label ? (jobs[label] ? [label] : []) : loadedFrom(rest.slice(1)));
    break;
  }
  case 'unload':
    unload(loadedFrom(plain(rest)));
    break;
  case 'remove':
    unload(jobs[rest[0]] ? [rest[0]] : []);
    break;
  case 'print': {
    const { domain, label } = target(rest[0]);
    if (!label) end(0, `${domain} = {\n\tservices = {\n${Object.keys(jobs).map((name) => `\t\t       0      -\t${name}`).join('\n')}\n\t}\n}`);
    if (!jobs[label]) end(113, notFound(label, domain));
    end(0, [
      `${domain}/${label} = {`, '\tactive count = 0', `\tpath = ${jobs[label].path}`, '\ttype = LaunchAgent', '\tstate = not running', '',
      `\tdomain = ${domain} [100000]`, '\truns = 0', '\tlast exit code = (never exited)', '}',
    ].join('\n'));
    break;
  }
  case 'kickstart': {
    const { domain, label } = target(plain(rest)[0]);
    end(jobs[label] ? 0 : 113, jobs[label] ? '' : notFound(label, domain));
    break;
  }
  case 'list':
    if (!rest[0]) end(0, ['PID\tStatus\tLabel', ...Object.keys(jobs).map((name) => `-\t0\t${name}`)].join('\n'));
    end(jobs[rest[0]] ? 0 : 113, jobs[rest[0]] ? `{\n\t"Label" = "${rest[0]}";\n\t"LastExitStatus" = 0;\n};` : `Could not find service "${rest[0]}" in domain for port`);
    break;
  case 'enable':
  case 'disable':
    end(0);
    break;
  case 'managername':
    end(0, 'Aqua');
    break;
  case 'managerpid':
    end(0, '1');
    break;
  case 'manageruid':
    end(0, String(process.getuid()));
    break;
  default:
    end(1, `the launchctl stand-in of #3438's tests does nothing for ${JSON.stringify(verb)}: it keeps a loaded job as a line of its state and starts none`);
}
