// #316 AC9: the matcher is held to a seeded corpus. For each default fail_closed entry shipped in
// crates/deep-hook/default-rules.json, this test takes that entry's planted call (named by the criterion) and
// generates at least 1,000 respellings with a seeded PRNG written here (no library), so each run reproduces from
// its seed. The respellings are exactly the transforms the criterion lists: quoting of the program word
// (p''kill, \pkill, "pkill"), a full path, the wrappers env/command/exec/nohup/timeout/sudo/xargs, nesting in
// `sh -c` and `bash -lc` up to three deep, sequencing (;, &&, ||, newline, before or after a harmless command)
// and subshells, combined randomly from the seed. Every respelling of a planted call must be denied. The allowed
// set, from the same seed, uses the same words only as an argument, a quoted string, a comment or a heredoc
// written to a file; every one must be allowed. Nothing is executed: each spelling is a JSON hook payload fed to
// deep-hook on stdin, which decides allow or deny.
//
// Every spelling is run twice: with the hub stopped (no hub at the address) and with a real hub up
// (startHub). Each planted spelling is denied in both runs, each allowed spelling is allowed in both, and the two
// runs agree call for call; a wrong decision names the first spelling, with its seed and index, and the run.
//
// Wrong program: a cargo feature on deep-hook, plant-issue-spellings, built into its own target folder. The plant
// denies only the exact spellings the issue text itself lists for each entry and allows everything else; the
// (wrong program) test runs the same corpus judgement on it and expects it to fail, naming the first spelling it
// let through. When the feature is absent (the base), the build throws and the wrong-program test fails, not
// passes. On the base, the real tests fail too: crates/deep-hook/default-rules.json is missing, so installDefaults
// throws before any spelling runs. See CORPUS.md.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  addWorktree, bash, buildDeepHook, carriesReasonNextStep, cleanup, decision, hook, installDefaults, makeHome,
  makeRepo, newSession, shown, startHub, stopHub, type Ran, type Rules, type Session,
} from './helpers.ts';

const PER_ENTRY = 1000;   // at least 1,000 respellings per entry (the criterion's floor)
const CONC = 12;          // bounded concurrency of deep-hook processes (8-16); the machine is shared
const TIMEOUT = 40 * 60 * 1000; // 40 minutes: the machine is heavily loaded

let REAL: string;
let PLANT: string;        // a path on a build, or the build's error message on the base
beforeAll(async () => {
  REAL = await buildDeepHook();
  // The plant is code the implementer writes; absent (the base), the build throws and the wrong-program test
  // fails rather than passing.
  PLANT = await buildDeepHook({ features: ['plant-issue-spellings'] }).catch((e: Error) => e.message);
}, 900_000);
afterEach(cleanup, 120_000);

// ---- A tiny seeded PRNG (mulberry32), written here, no library: each run reproduces from its seed.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const int = (r: () => number, min: number, max: number): number => min + Math.floor(r() * (max - min + 1));
/** POSIX single-quote a string so a shell parses it as one literal, escaping embedded single quotes. */
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const oneLine = (s: string): string => s.replace(/\n/g, '⏎');

// ---- A planted call: its program word, a full path to it, and the rest of its words (no spaces in any word).
interface Entry { prog: string; fullPath: string; args: string[] }

/** A representation of the program word: itself, quoted three ways, or a full path (the criterion's spellings). */
function progToken(e: Entry, r: () => number): string {
  const W = e.prog;
  switch (int(r, 0, 5)) {
    case 1: { const k = int(r, 1, W.length - 1); return `${W.slice(0, k)}''${W.slice(k)}`; } // p''kill
    case 2: return `\\${W}`;                                                                  // \pkill
    case 3: return `"${W}"`;                                                                  // "pkill"
    case 4: return `'${W}'`;                                                                  // 'pkill'
    case 5: return e.fullPath;                                                                // /usr/bin/pkill
    default: return W;                                                                        // pkill
  }
}
/** One respelling of the planted call: still the hazardous call, so it must be denied. */
function respell(e: Entry, r: () => number): string {
  const token = progToken(e, r);
  let cmd: string;
  if (r() < 0.25) {
    // xargs with the call's words on stdin, e.g. `echo -f node | xargs pkill`.
    cmd = `echo ${e.args.join(' ')} | xargs ${token}`;
  } else {
    cmd = e.args.length ? `${token} ${e.args.join(' ')}` : token;
    // 0-2 prefix wrappers (combined randomly).
    for (let i = int(r, 0, 2); i > 0; i--) {
      const w = pick(r, ['env', 'command', 'exec', 'nohup', 'sudo', 'timeout'] as const);
      cmd = w === 'timeout' ? `timeout ${int(r, 1, 30)} ${cmd}` : `${w} ${cmd}`;
    }
  }
  if (r() < 0.3) cmd = `( ${cmd} )`;                                 // subshell
  if (r() < 0.5) {                                                  // sequencing before or after a harmless command
    const h = pick(r, ['true', 'echo ok', ':'] as const);
    const op = pick(r, ['; ', ' && ', ' || ', '\n'] as const);
    cmd = r() < 0.5 ? `${h}${op}${cmd}` : `${cmd}${op}${h}`;
  }
  for (let d = int(r, 0, 3); d > 0; d--) {                          // nesting up to three deep, quoted at each level
    cmd = `${pick(r, ['sh -c', 'bash -lc'] as const)} ${shq(cmd)}`;
  }
  return cmd;
}
/** The same words in a position that only mentions them: an argument, a quoted string, a comment, a heredoc. */
function mentions(e: Entry, r: () => number): string {
  const words = [e.prog, ...e.args].join(' ');
  switch (int(r, 0, 3)) {
    case 1: return `${pick(r, ['echo', 'rg', 'grep -n'] as const)} '${words}' .`;  // a quoted string
    case 2: return `${pick(r, ['true', 'echo ok', ':'] as const)}  # ${words}`;    // after a # comment
    case 3: return `cat > notes${int(r, 0, 9999)}.txt <<'EOF'\n${words}\nEOF`;      // a heredoc written to a file
    default: return `echo ${words}`;                                               // as an argument
  }
}

interface Item { cmd: string; expect: 'deny' | 'allow'; kind: string }
/** The corpus for one entry from one seed: >=1,000 respellings (deny) and a mention set (allow). */
function corpus(e: Entry, seed: number): Item[] {
  const r = rng(seed);
  const deny = new Set<string>();
  for (let guard = 0; deny.size < PER_ENTRY && guard < 2_000_000; guard++) deny.add(respell(e, r));
  const words = [e.prog, ...e.args].join(' ');
  const allow = new Set<string>([                      // the four named shapes, always present
    `echo ${words}`,
    `rg '${words}' .`,
    `true  # ${words}`,
    `cat > notes.txt <<'EOF'\n${words}\nEOF`,
  ]);
  for (let i = 0; i < 48; i++) allow.add(mentions(e, r)); // more of the same shapes, from the seed
  return [
    ...[...deny].map((cmd): Item => ({ cmd, expect: 'deny', kind: 'respelling' })),
    ...[...allow].map((cmd): Item => ({ cmd, expect: 'allow', kind: 'mention' })),
  ];
}

// ---- Run the corpus through a binary at a given home/session with bounded concurrency.
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!, i);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
interface World { name: string; seed: number; home: string; session: Session; rules: Rules; items: Item[] }
/**
 * Runs every item through `binary`, hub away or up (the caller sets the hub), and checks each decision against
 * what the item expects. Throws at the first wrongly decided spelling, naming it, its seed and index, and the run.
 * With `checkReason`, a denial must also carry a shipped entry's reason and next_step verbatim. Returns the
 * decisions in order, for the call-for-call comparison.
 */
async function judge(binary: string, w: World, label: string, checkReason: boolean): Promise<('deny' | 'allow' | 'other')[]> {
  let done = 0;
  const ran = await mapLimit(w.items, CONC, async (it): Promise<{ d: ReturnType<typeof decision>; r: Ran }> => {
    const r = await hook(w.home, w.session, 'PreToolUse', bash(w.session, it.cmd), { binary, timeoutMs: 30_000 });
    if ((++done % 500) === 0) process.stderr.write(`  ${w.name} [${label}] ${done}/${w.items.length}\n`);
    return { d: decision(r), r };
  });
  for (let i = 0; i < w.items.length; i++) {
    const it = w.items[i]!;
    const { d, r } = ran[i]!;
    if (d !== it.expect) {
      throw Error(`AC9 ${w.name}: [${label}] spelling #${i} (seed 0x${w.seed.toString(16)}, ${it.kind}) was ${d}, expected ${it.expect}: \`${oneLine(it.cmd)}\` -> ${shown(r)}`);
    }
    if (checkReason && d === 'deny' && !carriesReasonNextStep(r, w.rules)) {
      throw Error(`AC9 ${w.name}: [${label}] denial #${i} (seed 0x${w.seed.toString(16)}) carries no default entry's reason+next_step: \`${oneLine(it.cmd)}\` -> ${shown(r)}`);
    }
  }
  return ran.map((x) => x.d);
}

// ---- The five default fail_closed entries and their planted calls (the criterion names each call). We are blind
// to the entry names and match spellings; we assert only the behaviour: each planted call denied, each mention
// allowed. Paths have no spaces (the temp folders are under /tmp/dh316-*), so words need no quoting.
interface Spec { name: string; seed: number; build: (home: string) => { session: Session; entry: Entry } }
const SPECS: Spec[] = [
  {
    name: 'kill-by-name (pkill -f node)', seed: 0x3160001,
    build: (home) => ({ session: newSession(home), entry: { prog: 'pkill', fullPath: '/usr/bin/pkill', args: ['-f', 'node'] } }),
  },
  {
    name: 'stash (git stash)', seed: 0x3160002,
    build: (home) => {
      const w1 = addWorktree(makeRepo(), 'w1');            // a real worktree session
      return { session: newSession(home, w1), entry: { prog: 'git', fullPath: '/usr/bin/git', args: ['stash'] } };
    },
  },
  {
    name: 'dispatch (gh workflow run deploy.yml --ref main)', seed: 0x3160003,
    build: (home) => ({ session: newSession(home), entry: { prog: 'gh', fullPath: '/usr/bin/gh', args: ['workflow', 'run', 'deploy.yml', '--ref', 'main'] } }),
  },
  {
    name: 'other-checkout (git -C <main> status)', seed: 0x3160004,
    build: (home) => {
      const repo = makeRepo();
      const w1 = addWorktree(repo, 'w1');
      addWorktree(repo, 'w2');
      return { session: newSession(home, w1), entry: { prog: 'git', fullPath: '/usr/bin/git', args: ['-C', repo.dir, 'status'] } };
    },
  },
  {
    name: 'agent-config (sed -i ~/.claude/settings.json)', seed: 0x3160005,
    build: (home) => {
      const claude = join(home, '.claude', 'settings.json');
      mkdirSync(dirname(claude), { recursive: true });
      writeFileSync(claude, '{}');
      return { session: newSession(home), entry: { prog: 'sed', fullPath: '/usr/bin/sed', args: ['-i', 's/a/b/', claude] } };
    },
  },
];

/** Builds a world for a spec: a fresh home with the shipped defaults installed, the entry's setup, and its corpus. */
function makeWorld(spec: Spec): World {
  const home = makeHome();
  const rules = installDefaults(home);                 // throws on the base (the defaults file is missing)
  const { session, entry } = spec.build(home);
  return { name: spec.name, seed: spec.seed, home, session, rules, items: corpus(entry, spec.seed) };
}

describe('AC9 #316.39bdfe08 a seeded corpus of at least 1,000 spellings per default entry is denied with the hub stopped and up, the runs agree, and mentions are allowed', () => {
  for (const spec of SPECS) {
    it(`AC9 ${spec.name}: every respelling denied and every mention allowed, hub stopped and up, agreeing call for call`, async () => {
      const w = makeWorld(spec);
      const denied = w.items.filter((i) => i.expect === 'deny').length;
      if (denied < PER_ENTRY) throw Error(`AC9 ${w.name}: generated only ${denied} respellings, need >= ${PER_ENTRY}`);
      const stopped = await judge(REAL, w, 'hub stopped', true);   // the fail_closed matcher decides
      const hub = await startHub(w.home);
      let up: ('deny' | 'allow' | 'other')[];
      try {
        up = await judge(REAL, w, 'hub up', false);                 // a real `deep hub run` decides
      } finally {
        await stopHub(hub);
      }
      for (let i = 0; i < w.items.length; i++) {
        if (stopped[i] !== up[i]) {
          throw Error(`AC9 ${w.name}: the two runs disagree at spelling #${i} (seed 0x${w.seed.toString(16)}): hub stopped ${stopped[i]}, hub up ${up[i]}: \`${oneLine(w.items[i]!.cmd)}\``);
        }
      }
    }, TIMEOUT);
  }

  it('AC9 (wrong program) a matcher that knows only this issue\'s spellings lets a respelling through and fails, naming the first', async () => {
    if (!PLANT.startsWith('/')) throw Error(`the plant plant-issue-spellings did not build: ${PLANT}`);
    const spec = SPECS[0]!;                                         // the kill entry's corpus is enough to catch it
    const w = makeWorld(spec);
    w.items = w.items.filter((i) => i.expect === 'deny');          // the respellings only; the plant should deny them all
    await expect(judge(PLANT, w, 'hub stopped (plant)', false)).rejects.toThrow(/was allow, expected deny/);
  }, TIMEOUT);
});
