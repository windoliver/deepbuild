// #1106 AC2: the app writes its variable reversed and XOR'd into test output and into a file in its checkout, and
// neither holds the value; a planted environment that loads by value fails, naming the evidence file. A check that
// needs the app runs through the hub's `run.start` with `environment: true` in a plain folder standing for its
// temporary checkout (#331's surface); its stack (fixtures/app.mjs) comes up from that folder with SHOP_API_KEY
// declared with `hosts:`. The check (fixtures/journey.mjs) asks the app for SHOP_API_KEY reversed and XOR'd with
// 0x5a, and prints both into its output, which the hub stores as the run's evidence; the app writes them to
// leak.txt in the checkout too. Reading: no file under the hub's root (its evidence above all) and not leak.txt
// holds the value in any of these forms: raw, reversed, XOR'd (raw bytes, or hex of either case), base64 of the raw.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bytesOf, cleanup, Client, COMMIT, filesUnder, hubEnv, JOURNEY, makeCheckout, NODE, SHOP_VALUE, startHub, stopHub, sub, tempDir, ulid, waitFor, world, XOR_KEY, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const MARKER = 'dh1106-journey-output-marker';
const xored = Buffer.from(Buffer.from(SHOP_VALUE, 'utf8').map((b) => b ^ XOR_KEY));
/** The forms of the value a careless app's copy could take, each as the bytes a file would hold. */
const FORMS: [string, Buffer][] = [
  ['raw', Buffer.from(SHOP_VALUE)],
  ['base64', Buffer.from(Buffer.from(SHOP_VALUE).toString('base64').replace(/=+$/, ''))],
  ['reversed', Buffer.from([...SHOP_VALUE].reverse().join(''))],
  ['XOR\'d (raw bytes)', xored],
  ['XOR\'d (hex)', Buffer.from(xored.toString('hex'))],
  ['XOR\'d (HEX)', Buffer.from(xored.toString('hex').toUpperCase())],
];

/**
 * AC2's reading: null when no file under the hub's root (the record, its evidence and logs) and not the app's file
 * in the checkout holds the value in any form; otherwise each file that does, the evidence files first, and the form.
 */
function evidenceProblem(root: string, checkout: string): string | null {
  const evidence = join(root, 'evidence');
  const files = [
    ...filesUnder(evidence),
    ...filesUnder(root, (p) => p === evidence),
    join(checkout, 'leak.txt'),
  ];
  const found: string[] = [];
  for (const path of files) {
    const bytes = bytesOf(path);
    if (!bytes) continue;
    for (const [form, needle] of FORMS) if (bytes.includes(needle)) found.push(`${path} holds the value ${form}`);
  }
  return found.length ? `the value reached what the run keeps: ${found.join('; ')}` : null;
}

async function scenario(plant?: string): Promise<{ root: string; checkout: string; done: Line; problem: string | null; marked: string[] }> {
  const w = await world();
  const checkout = makeCheckout(w.env);
  const hub = await startHub(sub(tempDir(), 'root'), hubEnv(w, plant));
  const client = await Client.open(hub);
  try {
    const { run } = await client.call('run.start', { check: 'journey:leak', claim: `claim:${ulid()}`, commit: COMMIT, cwd: checkout, argv: [NODE, JOURNEY], environment: true }, 60_000);
    const done = await waitFor(async () => (await client.events('run.finished')).find((e) => e.data?.run === run), 120_000, `run.finished for ${run}`);
    const marked = filesUnder(join(hub.root, 'evidence')).filter((p) => bytesOf(p)?.includes(MARKER));
    return { root: hub.root, checkout, done, problem: evidenceProblem(hub.root, checkout), marked };
  } finally {
    client.close();
    await stopHub(hub);
  }
}

describe('AC2 #1106.ef5f04c9 the app writes its variable reversed and XOR\'d into test output and into a file in its checkout, and neither holds the value; a planted environment that loads by value fails, naming the evidence file', () => {
  it('AC2 the check\'s output (the run\'s evidence) and leak.txt in its checkout hold the app\'s variable reversed and XOR\'d, and neither holds the value in any form', async () => {
    const s = await scenario();
    expect(s.done.data.outcome, `the check ran with its app up and passed (${JSON.stringify(s.done.data)})`).toBe('passed');
    expect(s.marked.length, 'the check\'s output reached the run\'s evidence under the hub\'s root').toBeGreaterThan(0);
    expect(existsSync(join(s.checkout, 'leak.txt')), 'the app wrote its copies into leak.txt in its checkout').toBe(true);
    expect(readFileSync(join(s.checkout, 'leak.txt'), 'utf8'), 'with a reversed copy of something it held').toMatch(/^reversed=.{8,}\n/);
    expect(s.problem).toBeNull();
  }, 300_000);

  it('AC2 (wrong program) an environment that loads SHOP_API_KEY by value (DEEP_HUB_PLANT=env-loads-by-value) fails the reading, naming the evidence file', async () => {
    const s = await scenario('env-loads-by-value');
    expect(s.marked.length, 'the scenario formed: the check\'s output reached the run\'s evidence').toBeGreaterThan(0);
    expect(s.problem, 'the reading passes on a stack that holds the value').not.toBeNull();
    expect(s.problem, 'and names the evidence file holding it').toContain(`${join(s.root, 'evidence')}/`);
  }, 300_000);
});
