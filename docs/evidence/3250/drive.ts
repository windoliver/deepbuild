// #3250 by hand: a real hub (`deep hub run`) in a temporary home, two Claude Code sessions it verifies through deep-hook,
// each ending one turn with a Stop. One transcript gives its cache writes split (300,000 one-hour, 800,000 five-minute),
// the other a write total of 1,000,000 with no split. Writes what the record holds (turn.usage) and what `deep numbers`
// says to docs/evidence/3250/drive.out. No model is called: the transcripts are fixtures written as Claude Code 2.1.299
// and later write them. Run through run.sh, which prints drive.out.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { Agent, cleanup, deep, events, makeHome, makeWorktree, startHub, stopHub, type Hub, type Session } from '../../../tests/acceptance/26/helpers.ts';
import { turn as stop, type Wrote } from '../../../tests/acceptance/3250/world.ts';

const OUT = fileURLToPath(new URL('./drive.out', import.meta.url));
const short = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');

it('#3250 by hand: two Claude Code stops through a real hub, and deep numbers', async () => {
  const out: string[] = [];
  const say = (line = ''): void => { out.push(line); };
  const { tmp, home } = makeHome();
  const wt = makeWorktree(join(tmp, 'work'));
  const agent = Agent.start(home, wt.path);
  let hub: Hub | undefined;
  try {
    hub = await startHub(home);
    const run = async (name: string, s: Session, lines: Wrote[]): Promise<void> => {
      await agent.hook(hub!, s, 'SessionStart');
      const usage = await stop({ hub: hub!, agent, session: s, home }, lines);
      say(name);
      say(`  session ${short(s.id)}`);
      if (!usage) { say('  no turn.usage recorded'); return; }
      const d = usage.data as { tokens: Record<string, unknown>; cost: Record<string, unknown> };
      say(`  turn.usage@${String((usage as { v?: unknown }).v)} tokens ${JSON.stringify(d.tokens)}`);
      say(`  cost ${JSON.stringify(d.cost)}`);
    };
    const split = agent.session(wt.path, 'start');
    const total = agent.session(wt.path, 'start');
    await run('split transcript: 300,000 one-hour + 800,000 five-minute writes', split, [
      { input: 10, output: 200, read: 5000, oneHour: 300_000 },
      { input: 10, output: 200, read: 5000, fiveMinute: 800_000 },
    ]);
    say();
    await run('total-only transcript: 1,000,000 writes, no split', total, [{ input: 10, output: 200, read: 5000, total: 1_000_000 }]);
    say();
    const usages = (await events(hub)).filter((e) => e.kind === 'turn.usage');
    say(`the record holds ${usages.length} turn.usage events, versions ${usages.map((e) => String((e as { v?: unknown }).v)).join(', ')}`);
    say();
    const shown = await deep(home, ['numbers']);
    say(`$ deep numbers   (exit ${shown.code}; the spend, turn cost and token lines of these two sessions)`);
    const ours = new Set([short(split.id), short(total.id)]);
    const turns = new Set(usages.map((e) => String((e.data as { turn?: unknown }).turn)));
    for (const line of shown.stdout.split('\n')) {
      const subject = /^(?:spend\.usd|cost\.turn|tokens\.session) (?:session:)?([^:]+):/.exec(line);
      if (subject && (ours.has(subject[1]!) || turns.has(subject[1]!))) say(`  ${line.replace(/ · \d+(?:ms|s|m)$/, '')}`);
    }
  } finally {
    if (hub) await stopHub(hub);
    await cleanup();
    writeFileSync(OUT, `${out.join('\n')}\n`);
  }
});
