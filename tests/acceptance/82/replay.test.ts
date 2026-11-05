// #82 Proof: replays of 20 recorded stops from Claude Code and Codex, with the claims each made.
//
// fixtures/stops.json holds the 20 stops, 10 per agent, each as the turn that ends in it, shaped like a recorded session
// of adapters/corpus and named by it, with the claim the design's stop rule says it makes (Every stop is judged). They
// replay through deep-hook into one hub: a Claude Code session on item 97 and a Codex session on item 98, each item's
// R1 (expired-token.sh) failing until FLAG, so the session's task stays open through all ten. For each stop the
// record must say what the fixture says: its agent.stop's `claim` (the stop rule's reading), and a claim.made for the
// session's task between that stop and the next one exactly when it is a claim. The hub runs with a 10 s hold: a
// claim is recorded at its stop whatever its checks say, so the replay doesn't wait for them.
import { readFileSync } from 'node:fs';
import { afterAll, describe, it } from 'vitest';
import { verdict,
  PROOF, EXPIRED, WORK_LINK, askDraft, claimsOf, cleanup, CodexSession, item, itemTask, lockedFor, makeWorld, must, said, Session,
  settle, startHub, stopsOf, type Ev, type Hub, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);

type Step = Record<string, string | boolean>;
interface Recorded { recorded: string; steps: Step[]; words: string; claim: boolean; why: string }
interface Agent { task: number; stops: Recorded[] }
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/stops.json', import.meta.url), 'utf8')) as { 'claude-code': Agent; codex: Agent };
const heartbeat = (text: string) => `<heartbeat>\n  <automation_id>expired-token</automation_id>\n  <current_time_iso>2026-11-03T09:10:00.000Z</current_time_iso>\n  <instructions>\n${text}\n  </instructions>\n</heartbeat>\n`;
const texts = (a: Agent) => a.stops.flatMap((s) => s.steps.flatMap((st) => ['typed', 'prompt', 'scheduled'].map((k) => st[k]).filter((v): v is string => typeof v === 'string' && !v.startsWith('Fix '))));

interface Replayed { agent: string; n: number; r: Recorded; session: string }
async function locked(hub: Hub, s: { id: string }, text: string): Promise<void> {
  const events = await settle(hub, (all) => { const ref = itemTask(all, s, text); return ref !== undefined && lockedFor(all, ref).length > 0; }, 60_000);
  must(itemTask(events, s, text) !== undefined, `BLOCKED: ${PROOF} the replay's "${text}" opens one task with its definition locked`);
}

async function claude(w: World, hub: Hub, out: Replayed[]): Promise<void> {
  const a = FIXTURE['claude-code'];
  let s = new Session(w);
  for (const [i, r] of a.stops.entries()) {
    for (const step of r.steps) {
      if (step.start) await s.start(step.start as 'startup' | 'resume');
      else if (step.clear) { await s.end('clear'); s = new Session(w); await s.start('clear'); }
      else if (typeof step.typed === 'string') { const text = step.typed.replace('{link}', WORK_LINK(a.task)); await s.typed(text); if (text.startsWith('Fix ')) await locked(hub, s, text); }
      else if (typeof step.scheduled === 'string') await s.scheduled(step.scheduled);
      else if (typeof step.peer === 'string') await s.peer(step.peer);
      else if (typeof step.handback === 'string') await s.handback(step.handback);
      else if (typeof step.read === 'string') await s.read(step.read);
      else if (step.edit) await s.bump();
    }
    await s.stop(r.words);
    out.push({ agent: 'claude-code', n: i + 1, r, session: s.id });
  }
}
async function codex(w: World, hub: Hub, out: Replayed[]): Promise<void> {
  const a = FIXTURE.codex;
  const s = new CodexSession(w);
  for (const [i, r] of a.stops.entries()) {
    for (const step of r.steps) {
      if (step.start) await s.start(step.start as 'startup');
      else if (typeof step.prompt === 'string') { const text = step.prompt.replace('{link}', WORK_LINK(a.task)); await s.prompt(text); if (text.startsWith('Fix ')) await locked(hub, s, text); }
      else if (typeof step.heartbeat === 'string') await s.prompt(heartbeat(step.heartbeat), 'heartbeat');
      else if (typeof step.goal === 'string') s.goalTurn(step.goal);
      else if (typeof step.shell === 'string') await s.shell(step.shell, step.shell.startsWith('cat') || step.shell.startsWith('sed') ? readFileSync(`${w.repo}/src/auth.js`, 'utf8') : 'ok');
      else if (step.patch) {
        const n = Number(/note: (\d+),/.exec(readFileSync(`${w.repo}/src/auth.js`, 'utf8'))?.[1]);
        await s.patch('src/auth.js', `  note: ${n},`, `  note: ${n + 1},`);
      }
    }
    await s.stop(r.words);
    out.push({ agent: 'codex', n: i + 1, r, session: s.id });
  }
}

describe(`${PROOF} replays of 20 recorded stops from Claude Code and Codex, with the claims each made`, () => {
  it(`${PROOF} 10 Claude Code and 10 Codex stops each make the claim the stop rule gives them, and no other`, async (ctx) => verdict(ctx, async () => {
    const cc = FIXTURE['claude-code'];
    const cx = FIXTURE.codex;
    must(cc.stops.length === 10 && cx.stops.length === 10, `BLOCKED: ${PROOF} the fixture holds 10 stops per agent`);
    const w = makeWorld({ items: [item(cc.task, 'Expired tokens are accepted', [EXPIRED]), item(cx.task, 'Expired tokens are accepted', [EXPIRED])], drafts: [...new Set([...texts(cc), ...texts(cx)])].map(askDraft) });
    const hub = await startHub(w, { hold: 10_000 });
    const replayed: Replayed[] = [];
    await claude(w, hub, replayed);
    await codex(w, hub, replayed);
    // A stop's events can land in the record after its reply, so the n-th fixture stop of an agent is the n-th
    // agent.stop of that agent's sessions, and its claims are those made before the agent's next stop.
    const sessionsOf = (agent: string) => [...new Set(replayed.filter((x) => x.agent === agent).map((x) => x.session))];
    const stopsFor = (all: readonly Ev[], agent: string) => sessionsOf(agent).flatMap((id) => stopsOf(all, { id }));
    const events = await settle(hub, (all) => stopsFor(all, 'claude-code').length >= 10 && stopsFor(all, 'codex').length >= 10, 30_000);
    const taskOf = (agent: string): string | undefined => { const n = agent === 'codex' ? cx.task : cc.task; return events.find((e) => e.kind === 'user.ask' && e.data.text === `Fix ${WORK_LINK(n)}` && Array.isArray(e.data.tasks) && e.data.tasks.length === 1)?.data.tasks[0] as string | undefined; };
    const wrong: string[] = [];
    for (const x of replayed) {
      const ref = taskOf(x.agent);
      const recorded = stopsFor(events, x.agent);
      const stop: Ev | undefined = recorded[x.n - 1];
      const next = recorded[x.n]?.log_pos ?? Infinity;
      const name = `${x.agent} stop ${x.n} (${x.r.recorded}; ${stop ? `agent.stop ${stop.id}` : 'no agent.stop'})`;
      if (!stop) { wrong.push(`${name}: not recorded`); continue; }
      const made = ref ? claimsOf(events, ref, stop.log_pos - 1, next) : [];
      if (stop.data.claim !== x.r.claim) wrong.push(`${name}: the stop rule must read it as ${x.r.claim ? 'a claim' : 'no claim'} (${x.r.why}); it read claim: ${String(stop.data.claim)}`);
      if ((made.length > 0) !== x.r.claim) wrong.push(`${name}: ${x.r.claim ? `must make a claim for ${ref ?? 'its task'} (${x.r.why}); none` : `must make no claim (${x.r.why}); it made ${made.map(said).join('; ')}`}`);
    }
    must(wrong.length === 0, `${PROOF} ${wrong.length} of 20 replayed stops made the wrong claim:\n${wrong.join('\n')}`);
  }), 600_000);
});
