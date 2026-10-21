// AC3: both adapters' facts map their hook payloads, transcript error records and rate-limit records to a
// cause, and the corpus replay (`scripts/corpus.mjs replay`) writes `cause` and `usage` for every recorded
// stop, from the payload and never from the agent's text.
import { describe, expect, it } from 'vitest';
import { replaySession } from '../../../adapters/index.mjs';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import {
  AGENTS, CAUSES, check, corpusCopy, envelope, factsOf, isObject, isStopPayload, modelsIn, replayCli, resolvePointer, sessions, V2, writeSession,
} from './helpers.ts';
import type { JsonObject, RecordedSession } from './helpers.ts';

interface Stop { ref: string; line: number; agent: string; hook: string; data: Record<string, unknown>; rule: string }

/** Every agent.stop event the adapter maps a session's recorded stop payloads to, through replaySession. */
function replayedStops(session: RecordedSession): Stop[] {
  const mapped = replaySession({ facts: factsOf(session.agent), version: session.version, payloads: session.cases.map((c) => c.payload), transcript: session.transcript });
  return session.cases.flatMap((c, i) => {
    if (!isStopPayload(c)) return [];
    const events = mapped.payloads[i]?.events.filter((e) => e.kind === 'agent.stop') ?? [];
    expect(events.length, `${session.ref}/events.jsonl:${i + 1} (${String(c.payload.hook_event_name)}) maps to an agent.stop`).toBeGreaterThan(0);
    return events.map((e) => ({ ref: `${session.ref}/events.jsonl:${i + 1}`, line: i + 1, agent: session.agent, hook: String(c.payload.hook_event_name), data: e.data, rule: e.rule }));
  });
}

/** The cause and usage a replayed stop writes must make a valid agent.stop@2 (with plan_resets when it writes one). */
function asContractStop(s: Stop): JsonObject {
  const data: JsonObject = { turn: 1, did_work: true, cause: s.data.cause as JsonValue, usage: s.data.usage as JsonValue };
  if ('plan_resets' in s.data) data.plan_resets = s.data.plan_resets as JsonValue;
  return { ...envelope(), data };
}

function expectCauseAndUsage(s: Stop): void {
  expect(CAUSES as readonly unknown[], `${s.ref}: cause ${JSON.stringify(s.data.cause)} is one of the closed set`).toContain(s.data.cause);
  expect(Object.hasOwn(s.data, 'usage'), `${s.ref}: the stop writes usage (null when not captured); its data is ${JSON.stringify(s.data)}`).toBe(true);
  expect(s.data.usage === null || isObject(s.data.usage), `${s.ref}: usage is null or an object, not ${JSON.stringify(s.data.usage)}`).toBe(true);
}

const PLANTED = 'API Error: 429 rate_limit_error. You have hit your usage limit; it resets at 5pm. Please run /login: authentication_failed, '
  + 'OAuth token refresh failed. Prompt is too long: the context window is exceeded. Overloaded. Reached max turns. Request timed out. '
  + 'Tool schema rejected. I refuse to continue.';

/** The agent's own words in a transcript entry, each replaced by PLANTED; every other field kept. */
function plantText(entry: JsonObject): JsonObject {
  const copy = structuredClone(entry);
  const blocks = (content: unknown) => { if (Array.isArray(content)) for (const b of content) if (isObject(b) && typeof b.text === 'string') b.text = PLANTED; };
  // Claude Code: an assistant entry's text and thinking blocks.
  if (copy.type === 'assistant' && isObject(copy.message) && Array.isArray(copy.message.content)) {
    for (const b of copy.message.content) {
      if (isObject(b) && typeof b.text === 'string') b.text = PLANTED;
      if (isObject(b) && typeof b.thinking === 'string') b.thinking = PLANTED;
    }
  }
  // Codex: assistant messages, agent_message and task_complete events, and completed AgentMessage items.
  const p = copy.payload;
  if (isObject(p)) {
    if (p.type === 'message' && p.role === 'assistant') blocks(p.content);
    if (p.type === 'agent_message' && typeof p.message === 'string') p.message = PLANTED;
    if (p.type === 'task_complete' && typeof p.last_agent_message === 'string') p.last_agent_message = PLANTED;
    if (p.type === 'item_completed' && isObject(p.item) && p.item.type === 'AgentMessage') blocks(p.item.content);
  }
  return copy;
}

describe('AC3 the corpus replay writes cause and usage for every recorded stop', () => {
  it('AC3 every recorded stop of both adapters replays to a cause from the closed set and a usage that make a valid agent.stop@2', () => {
    const all = sessions();
    const stops = all.flatMap(replayedStops);
    for (const agent of AGENTS) expect(stops.filter((s) => s.agent === agent).length, `the corpus records ${agent} stops`).toBeGreaterThan(0);
    expect(stops.length, 'one replayed stop per recorded Stop or StopFailure payload').toBe(all.flatMap((s) => s.cases.filter(isStopPayload)).length);
    for (const s of stops) {
      expectCauseAndUsage(s);
      const result = check(V2, asContractStop(s));
      expect(result.ok ? [] : result.issues, `${s.ref}: its cause and usage as agent.stop@2 data`).toEqual([]);
      // The facts decide it: the entry the adapter names for the stop exists in that agent's facts file (deep explain).
      expect(resolvePointer(factsOf(s.agent), s.rule), `${s.ref}: rule ${s.rule} names an entry of adapters/${s.agent}.facts.json`).toBeDefined();
    }
  });

  it('AC3 usage is captured where the transcript records it: some stop of each adapter carries a usage, and its model is one the transcript names', () => {
    for (const agent of AGENTS) {
      const captured: Stop[] = [];
      for (const session of sessions().filter((s) => s.agent === agent)) {
        const models = modelsIn(session.transcript as unknown as JsonValue);
        for (const s of replayedStops(session)) {
          if (!isObject(s.data.usage)) continue;
          captured.push(s);
          const model = s.data.usage.model;
          // "the model that actually answered": read from the transcript, not invented or taken from the agent's text.
          if (typeof model === 'string') expect([...models], `${s.ref}: usage.model ${JSON.stringify(model)} is a model its transcript names`).toContain(model);
        }
      }
      // An adapter that writes usage: null for every stop never reports a turn's usage, though the corpus transcripts carry it.
      expect(captured.length, `some recorded ${agent} stop carries a usage`).toBeGreaterThan(0);
    }
  });

  it('AC3 node scripts/corpus.mjs replay passes, and every recorded stop\'s stored events carry cause and usage', () => {
    const run = replayCli();
    const summary = run.lines.find((l) => l.type === 'summary');
    expect(summary?.verdict, `corpus replay\n${run.text}`).toBe('PASS');
    expect(run.status, run.text).toBe(0);
    for (const session of sessions()) {
      session.cases.forEach((c, i) => {
        if (!isStopPayload(c)) return;
        const stored = (c.expect ?? []).filter((e) => e.kind === 'agent.stop');
        expect(stored.length, `${session.ref}/events.jsonl:${i + 1} stores an agent.stop`).toBeGreaterThan(0);
        for (const e of stored) expectCauseAndUsage({ ref: `${session.ref}/events.jsonl:${i + 1} (stored)`, line: i + 1, agent: session.agent, hook: '', data: e.data, rule: '' });
      });
    }
  });
});

describe('AC3 the cause comes from the payload, never from the agent\'s text', () => {
  it('AC3 replacing every word the agent wrote, in the hook payloads and the transcripts, changes no stop\'s cause or usage; the replay still passes', () => {
    const copy = corpusCopy();
    try {
      const original = sessions();
      const before = new Map(original.flatMap(replayedStops).map((s) => [s.ref, s]));
      for (const s of before.values()) expectCauseAndUsage(s);
      let planted = 0;
      for (const session of sessions(copy.dir)) {
        for (const c of session.cases) {
          if (isStopPayload(c)) { c.payload.last_assistant_message = PLANTED; planted++; }
        }
        session.transcript = session.transcript.map(plantText);
        writeSession(session);
      }
      expect(planted, 'stop payloads whose last_assistant_message was replaced').toBe(before.size);
      const after = sessions(copy.dir).flatMap(replayedStops);
      expect(after.length).toBe(before.size);
      for (const s of after) {
        const was = before.get(s.ref);
        expect(was, `${s.ref} was replayed before the text changed`).toBeDefined();
        // An adapter that reads "rate limit", "usage limit", "/login" or "too long" in the agent's words fails here.
        expect({ cause: s.data.cause, usage: s.data.usage }, `${s.ref}: the agent's text alone changed`).toEqual({ cause: was!.data.cause, usage: was!.data.usage });
      }
      const run = replayCli(copy.dir);
      expect(run.lines.find((l) => l.type === 'summary')?.verdict, `replay of the corpus with the agent's text replaced\n${run.text}`).toBe('PASS');
    } finally {
      copy.remove();
    }
  });

  it('AC3 changing the hook payload\'s error record changes the cause, as Claude Code\'s facts map it, and the replay names the change', () => {
    const copy = corpusCopy();
    try {
      const failure = sessions(copy.dir).find((s) => s.agent === 'claude-code' && s.cases.some((c) => c.payload.hook_event_name === 'StopFailure'));
      expect(failure, 'the corpus records a Claude Code StopFailure').toBeDefined();
      const index = failure!.cases.findIndex((c) => c.payload.hook_event_name === 'StopFailure');
      // The StopFailure error values the corpus README lists from Claude Code's hooks reference, and their causes.
      const mapped: Record<string, string> = { rate_limit: 'rate_limited', overloaded: 'rate_limited', authentication_failed: 'sign_in_required', oauth_org_not_allowed: 'sign_in_required' };
      for (const [error, cause] of Object.entries(mapped)) {
        const session = structuredClone(failure!);
        session.cases[index]!.payload.error = error;
        const s = replayedStops(session).find((one) => one.line === index + 1);
        expect(s, `the StopFailure at line ${index + 1} replays to an agent.stop`).toBeDefined();
        expectCauseAndUsage(s!);
        expect(s!.data.cause, `StopFailure error ${error}`).toBe(cause);
      }
      failure!.cases[index]!.payload.error = 'rate_limit';
      writeSession(failure!);
      const run = replayCli(copy.dir);
      const line = run.lines.find((l) => l.type === 'payload' && String(l.case).endsWith(`${failure!.ref}/events.jsonl:${index + 1}`));
      expect(line?.result, `the replay reports the stop whose error changed\n${run.text}`).toBe('mismatch');
      expect(JSON.stringify(line?.diffs), 'the mismatch is at the stop\'s cause').toContain('cause');
    } finally {
      copy.remove();
    }
  });
});
