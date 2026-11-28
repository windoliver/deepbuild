// #3439 AC3 (#3439.9382967d), its first clause: "A hub started as the login service starts it has a collector in its
// main thread, its core worker and a parser". The rest of the criterion, `hub-idle` against the design's 150 MB and
// the merge base over 20 alternated pairs with a planted `shedStartup` read beside it, is the budget window's on a
// reference Mac and is not judged here (README: Not covered here), so a pass of this file alone proves the clause
// above and no more.
//
// `deep hub start` writes the login service's definition and hands it to the service manager; the suite's stand-in
// (fixtures/launcher.mjs, behind $DEEP_HUB_LAUNCHER) starts the job from that definition: its program arguments and
// its environment, as written. Each thread's collector is read through Node's inspector (README: Reading a collector).
import { afterEach, expect, it } from 'vitest';
import { cleanup, deep, makeHome, own, shown } from '../27/helpers.ts';
import { AC, jobOf, launcher, logOf, redact, shownThreads, threadsOf, told } from './helpers.ts';

afterEach(cleanup, 120_000);

it(`${AC.service} a hub started as the login service starts it has a collector in its main thread, its core worker and a parser`, async () => {
  const { home, tmp, bin } = makeHome();
  const stand = launcher(bin, tmp);
  const started = await deep(home, ['hub', 'start'], { env: { DEEP_HUB_LAUNCHER: stand.path } });
  const job = jobOf(stand.state);
  own(job?.pid);
  expect(job, `${AC.service} deep hub start hands the login service's definition to the service manager, which starts the hub from it: the stand-in was never called, or read no program arguments. deep hub start: ${redact(shown(started))}`).toBeDefined();
  const service = `the login service's program arguments: ${redact(JSON.stringify(job!.program))}; its environment sets ${Object.keys(job!.env).join(', ') || 'nothing'}${job!.env.NODE_OPTIONS ? `, NODE_OPTIONS=${redact(job!.env.NODE_OPTIONS)}` : ''}`;
  expect(started.code, `${AC.service} the hub the login service started answers, so deep hub start exits 0: ${redact(shown(started))}; ${service}; the job's log:\n${told(logOf(job!), 2000)}\n`).toBe(0);

  // The hub holds its core worker and one parser from the start.
  const read = await threadsOf(job!.pid, () => logOf(job!), 2);
  const seen = `${shownThreads(read.threads)}${read.why ? `; the reading stopped: ${read.why}` : ''}; ${service}`;
  const [main, ...workers] = read.threads;
  expect(main?.collector, `${AC.service} the main thread of a hub started as the login service starts it has a collector, given when the process launched; ${seen}`).toBe('function');
  const core = workers.filter((t) => /core/i.test(t.name));
  const parsers = workers.filter((t) => /pars/i.test(t.name));
  expect(core.map((t) => t.collector), `${AC.service} the hub's core worker has a collector; ${seen}`).toEqual(['function']);
  expect(parsers.length, `${AC.service} the hub holds a parser; ${seen}`).toBeGreaterThan(0);
  expect(parsers.map((t) => t.collector).filter((c) => c !== 'function'), `${AC.service} the hub's parser has a collector; ${seen}`).toEqual([]);
  expect(workers.filter((t) => t.collector !== 'function').map((t) => t.name), `${AC.service} every worker thread of the hub has the collector; ${seen}`).toEqual([]);
  expect(read.why, `${AC.service} every thread was read; ${seen}`).toBeUndefined();
}, 600_000);
