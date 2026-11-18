// #2652 AC2 #2652.71abd7a1: `outputOf` returns the same 2,000 characters as the merge base for runs that printed 100
// characters, 2,000, 2,001 and 8 MB, standard error before standard output as today; a planted runner that keeps the
// first 2,000 characters fails, naming the run.
//
// `outputOf` is what a send-back quotes for a command the agent's final message tells you to run (stop-judging.ts:
// "the command your final message tells you to run, `<command>`, fails:\n<what it printed>"), so the test reads it
// there: through a real hub, deep-hook and a Claude Code stand-in, with #323's helpers, which drive that path. One
// session's final message tells you to run four commands; each prints its characters and fails, and the stop's reply
// quotes each one's output. The merge base's rule is written here: standard error, a newline, standard output, each left
// out when it is only white space, and the last 2,000 characters of that (README: The readings).
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { begin, cleanup, draft, FIX, FLAG, lastPos, makeWorld, replyText, runsOf, settle, shown, startHub, strings, taskVerdicts, type Ev } from '../323/helpers.ts';
import { AC2, PLANTS } from './helpers.ts';

afterAll(cleanup, 120_000);

const PROMPT = 'make the auth middleware reject expired tokens and report what each check printed';
const SIZES = [100, 2000, 2001, 8_000_000] as const;
const command = (n: number): string => `node scripts/out.mjs ${n}`;
/**
 * `n` characters of a run's output for one stream, `tag` naming it: 9-character units (`E0000017` and a space, with a
 * newline for every eighth), so every 2,000 characters of one are unlike any other's.
 */
const textOf = (tag: string, n: number): string => {
  let s = '';
  for (let i = 0; s.length < n; i++) s += `${tag}${String(i).padStart(7, '0')}${i % 8 === 7 ? '\n' : ' '}`;
  return s.slice(0, n);
};
/** A run that prints `n` characters: up to 500 of them on standard output, written first, and the rest on standard error. */
const streams = (n: number): { stdout: string; stderr: string } => {
  const out = Math.min(500, Math.floor(n / 2));
  return { stdout: textOf('O', out), stderr: textOf('E', n - out) };
};
/** The merge base's outputOf (gate-runner.ts), on what the run printed: the 2,000 characters a send-back quotes. */
const baseOutputOf = (r: { stdout: string; stderr: string }): string => [r.stderr, r.stdout].filter((t) => t.trim()).join('\n').slice(-2000);
/** The program the commands run, from the same generator; it fails so the gate sends the claim back with its output. */
const OUT = [
  `const textOf = ${textOf.toString()};`,
  `const streams = ${streams.toString()};`,
  'const { stdout, stderr } = streams(Number(process.argv[2]));',
  'process.stdout.write(stdout);',
  'process.stderr.write(stderr);',
  'process.exitCode = 1;',
  '',
].join('\n');
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const FINAL = ['Expired tokens are rejected now. To see what each check prints, run these:', '', '```sh', ...SIZES.map(command), '```'].join('\n');

interface Told { n: number; command: string; run: string; finished: Ev | undefined; expected: string }
interface Scenario { reply: string; told: Told[]; events: Ev[]; stopShown: string }

/** One session on a fresh world, through a hub with `plant`: its stop tells you to run the four commands. */
async function scenario(plant?: string): Promise<Scenario> {
  const w = await makeWorld({ drafts: [draft(PROMPT)], files: { 'scripts/out.mjs': OUT } });
  const hub = await startHub(w, plant);
  const { s, ref } = await begin(w, hub, w.repos.repo!, PROMPT, AC2);
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  const since = await lastPos(hub);
  const stop = await s.stop(FINAL);
  const ranAll = (all: Ev[]) => SIZES.every((n) => runsOf(all, ref, since).some((x) => x.finished !== undefined && strings(x.started.data).includes(command(n))));
  const events = await settle(hub, (all) => ranAll(all) && taskVerdicts(all, ref, since).length > 0, 300_000);
  const runs = runsOf(events, ref, since);
  const told = SIZES.map((n) => {
    const r = runs.find((x) => strings(x.started.data).includes(command(n)));
    return { n, command: command(n), run: String(r?.started.data.run ?? 'no run'), finished: r?.finished, expected: baseOutputOf(streams(n)) };
  });
  for (const t of told) {
    const { stdout, stderr } = streams(t.n);
    const evidence = (t.finished?.data.evidence ?? []) as string[];
    // The setup, not the criterion: each command ran once on the claim, failed, and printed what the program writes.
    if (t.finished?.data.outcome !== 'failed' || evidence[0] !== sha(stdout) || evidence[1] !== sha(stderr)) {
      throw Error(`BLOCKED: \`${t.command}\` must run on the claim, fail, and keep the ${t.n} characters it printed as its evidence: ${t.run} ${JSON.stringify(t.finished?.data ?? 'never finished').slice(0, 600)}; the claim's runs are ${runs.map((x) => String(x.started.data.check)).join(', ') || 'none'}`);
    }
    // A run that ended after the stop's reply ended past the hold: the reply could not quote it on this machine now.
    if (t.finished!.ts > stop.ended) throw Error(`BLOCKED: ${t.run} (\`${t.command}\`) ended ${t.finished!.ts - stop.ended} ms after the stop's reply, past the stop's hold; run again on a quieter machine`);
  }
  return { reply: replyText(stop), told, events, stopShown: shown(stop) };
}

/**
 * Each command's run is quoted with the merge base's 2,000 characters: the reply holds "`<command>`, fails:", a
 * newline, exactly those characters, and the send-back's next mark (a semicolon before the next command, a full stop
 * at its end). Every run that isn't is named, with what the reply quotes for it.
 */
function quotesAsTheBase(r: Scenario): void {
  const wrong: string[] = [];
  for (const t of r.told) {
    const head = `\`${t.command}\`, fails:\n`;
    if (r.reply.includes(`${head}${t.expected};`) || r.reply.includes(`${head}${t.expected}.`)) continue;
    const at = r.reply.indexOf(head);
    const quoted = at < 0 ? 'nothing: the reply never names it as failing' : JSON.stringify(r.reply.slice(at + head.length, at + head.length + 2010));
    wrong.push(`${t.run}, which printed ${t.n.toLocaleString('en-US')} characters (\`${t.command}\`), is quoted as ${quoted}; the merge base quotes its last ${t.expected.length.toLocaleString('en-US')} characters, standard error before standard output: ${JSON.stringify(t.expected)}`);
  }
  expect(wrong, `outputOf must return the same 2,000 characters as the merge base, standard error before standard output:\n${wrong.join('\n')}\n(the stop's reply: ${r.stopShown.slice(0, 600)})`).toEqual([]);
}

describe(`${AC2} outputOf returns the same 2,000 characters as the merge base for runs that printed 100 characters, 2,000, 2,001 and 8 MB, standard error before standard output; a planted runner that keeps the first 2,000 characters fails, naming the run`, () => {
  it(`${AC2} four commands the final message tells you to run print 100, 2,000, 2,001 and 8,000,000 characters and fail: the send-back quotes each with the merge base's 2,000 characters`, async () => {
    quotesAsTheBase(await scenario());
  }, 1_800_000);

  it(`${AC2} (wrong program ${PLANTS.head}) a runner that keeps the first 2,000 characters fails, naming the run that printed 8 MB`, async () => {
    const r = await scenario(PLANTS.head);
    let message: string | null = null;
    try { quotesAsTheBase(r); } catch (error) { message = error instanceof Error ? error.message : String(error); }
    const big = r.told.find((t) => t.n === 8_000_000)!;
    expect(message, `${PLANTS.head}: the planted runner passed the judgement, so it proves nothing`).not.toBeNull();
    expect(message, `${PLANTS.head}: the failure must name the run that printed 8 MB, ${big.run}`).toContain(big.run);
  }, 1_800_000);
});
