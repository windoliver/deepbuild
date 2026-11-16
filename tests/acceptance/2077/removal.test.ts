// #2077: installed CLI -> hub -> runner -> real configuration eval -> recorded
// outcome -> rule file/list. Only the agents and judge are scripted.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import {
  AFTER, BEFORE, FILE, RULE, allEvents, cleanup, control, deep, fixture, frozenAt,
  isPlan, jobs, lessons, observations, recorded, start, stopHub, until, window,
} from './helpers.ts';

afterAll(cleanup, 30000);

for (const which of ['adopt', 'regresses', 'INCONCLUSIVE'] as const) {
  const criterion = which === 'INCONCLUSIVE' ? 'AC3 #2077.c43a0799' : 'AC2 #2077.d2415960';
  it(`AC1 #2077.c76c4641 ${criterion}: installed removal starts exactly one frozen eval, returns its handle, then ${which}`, async () => {
    const w = await fixture(which);
    const hub = await start(w);
    try {
      const list = await lessons(w);
      const offered = list.filter((l) => l.kind === 'removal' && l.text === RULE);
      expect(offered, `the untouched legacy/** rule is offered: ${JSON.stringify(list)}`).toHaveLength(1);
      const lesson = offered[0]!;
      const before = readFileSync(join(w.repo, FILE));
      expect(before.toString()).toBe(BEFORE);
      const initialJobs = new Set((await jobs(hub)).map((j) => j.job));
      // Deliberately at the installed runner's reserve. A valid request is recorded
      // and returns a handle, but may not run either external side yet.
      const reset = Date.now() + 3600000;
      await window(hub, 95, reset);
      const reply = await deep(w, ['memory', 'remove', lesson.id]);
      const answer = `${reply.stdout}\n${reply.stderr}`;
      const added = (await jobs(hub)).filter((j) => !initialJobs.has(j.job));
      console.log(`lesson ${lesson.id}: ${JSON.stringify({ code: reply.code, answer, jobs: added.map((j) => ({ job: j.job, state: j.state })) })}`);
      expect(added, `taking ${lesson.id} (${RULE}) must record one configuration eval job, not BLOCKED with none; answer: ${answer}`).toHaveLength(1);
      const job = added[0]!;
      expect(reply.timedOut, `the command returns the eval's handle while it waits: ${answer}`).toBe(false);
      expect(job.state, 'the eval is a waiting runner job at the reserve').toBe('waiting');
      expect(job.blocked?.cause, 'it waits on your plan reserve, not a missing eval fixture').toBe('plan window');
      expect(observations(w), 'neither side nor judge starts past your reserve').toEqual([]);
      expect(readFileSync(join(w.repo, FILE)).equals(before), 'not removed while queued').toBe(true);
      expect((await lessons(w)).map((l) => l.id), 'the running/waiting eval does not resolve the lesson').toContain(lesson.id);
      expect((await allEvents(hub)).filter((e) => e.kind === 'job.recorded' && e.data.job === job.job), 'one runner job is in the record, not just in the reply').toHaveLength(1);

      // A later window has room. The boundary holds every agent until the CLI
      // and list have been observed, so async assertions never race a fast eval.
      await window(hub, 5, reset + 3600000);
      const started = await until(() => observations(w), (xs) => xs.some((x) => x.kind === 'work'));
      expect(started.some((x) => x.kind === 'work'), 'the runner actually starts the configuration replay when room returns').toBe(true);
      const frozen = await frozenAt(started.find((x) => x.kind === 'work')!.recorded, w);
      expect([job.job, frozen.id].some((handle) => typeof handle === 'string' && answer.includes(handle)), 'the command returns the job or frozen eval handle while it runs').toBe(true);
      expect((await lessons(w)).map((l) => l.id), 'lesson stays listed while external agents are working').toContain(lesson.id);
      expect(readFileSync(join(w.repo, FILE)).equals(before), 'preparing the candidate never edits the live rule file').toBe(true);
      writeFileSync(w.release, 'go\n');

      const outcomeRows = await until(async () => recorded(await allEvents(hub), w), (rows) => rows.some(({ value }) => value.after?.outcome === which || value.outcome === which));
      const outcomes = outcomeRows.filter(({ value }) => value.after?.outcome === which || value.outcome === which);
      expect(outcomes.length, `the actual replay records ${which}, not a synthetic removal result`).toBeGreaterThan(0);
      const linked = outcomes.filter(({ event }) => JSON.stringify(event).includes(job.job) || JSON.stringify(event).includes(frozen.id));
      expect(linked.length, 'the recorded outcome belongs to the eval this removal started').toBeGreaterThan(0);
      const all = await until(() => observations(w), (xs) => xs.some((x) => x.kind === 'judge'));
      const work = all.filter((x) => x.kind === 'work');
      expect(all.filter((x) => x.kind === 'judge').length, 'the real eval consults its external judge').toBeGreaterThan(0);
      const plannedCount = (frozen.tasks.length + (frozen.fitted?.length ?? 0)) * 2 * frozen.repeats;
      expect(work, 'every frozen task runs on each side for the frozen repeats, never a second eval').toHaveLength(plannedCount);
      for (const task of [...frozen.tasks, ...(frozen.fitted ?? [])]) {
        const prompt = `Fix cart item ${w.taskIds.indexOf(task)}: count its quantity in the total.`;
        for (const side of ['base', 'change']) expect(work.filter((x) => x.prompt === prompt && x.side === side), `${task}: its own archived words, once per repeat on ${side}`).toHaveLength(frozen.repeats);
      }
      for (const side of ['base', 'change']) {
        expect(work.filter((x) => x.side === side)).toHaveLength(plannedCount / 2);
        for (const seen of work.filter((x) => x.side === side)) {
          expect(seen.bytes, `${side} agent receives the correct candidate, not the live file`).toBe(side === 'base' ? BEFORE : AFTER);
          expect(await frozenAt(seen.recorded, w), 'the same frozen plan is already committed at every agent entry').toEqual(frozen);
        }
      }
      for (const { value } of outcomeRows.filter(({ value }) => isPlan(value))) expect(value, 'no task, variant or repeat changes after starting').toEqual(frozen);

      // Completion and human-readable explanation are read-only operations. Do
      // NOT issue a second remove to obtain a final answer or finish the first.
      const end = await until(() => control(hub, 'job.status', { job: job.job }), (j) => ['finished', 'refused', 'stopped', 'lost'].includes(j.state));
      expect(end.state, `the eval completes: ${JSON.stringify(end)}`).toBe('finished');
      const output = await control(hub, 'job.output', { job: job.job });
      const explanation = JSON.stringify({ end, output });
      expect((await jobs(hub)).filter((j) => !initialJobs.has(j.job) && j.kind === job.kind), 'one configuration eval, even after completion').toHaveLength(1);
      if (which === 'adopt') {
        await until(() => readFileSync(join(w.repo, FILE)).toString(), (text) => text === AFTER);
        expect(readFileSync(join(w.repo, FILE)).equals(Buffer.from(AFTER)), 'adopt removes exactly that line').toBe(true);
        const decisions = (await allEvents(hub)).filter((e) => e.kind === 'decision.created' && [job.job, frozen.id].some((handle) => typeof handle === 'string' && JSON.stringify(e).includes(handle)));
        expect(decisions.length, 'the removal decision cites this eval, not an unrecorded agent promise').toBeGreaterThan(0);
        expect(JSON.stringify(decisions), 'decision identifies the removed lesson/rule').toMatch(new RegExp(`${lesson.id}|${RULE}`));
        expect(decisions.every((d) => linked.some(({ event }) => event.log_pos < d.log_pos)), 'the adopt outcome is recorded before the removal decision').toBe(true);
        expect((await lessons(w)).map((l) => l.id), 'completed adopt resolves this lesson').not.toContain(lesson.id);
      } else {
        expect(readFileSync(join(w.repo, FILE)).equals(before), `${which} leaves all bytes, including CRLF/trailing spaces, unchanged`).toBe(true);
        if (which === 'regresses') {
          expect(explanation, 'the asynchronous answer reports the regression').toMatch(/regress/i);
          for (const task of frozen.tasks) expect(explanation, `answer names broken task ${task}`).toContain(task);
        } else {
          expect(explanation, 'the asynchronous answer says INCONCLUSIVE').toContain('INCONCLUSIVE');
          expect(explanation, 'the answer explains why the judge could not decide').toMatch(/missing|grade|metric|judge|captur/i);
          expect((await lessons(w)).map((l) => l.id), 'an inconclusive reading cannot resolve the lesson').toContain(lesson.id);
        }
      }
    } finally {
      // Release our boundary even on an assertion failure, then stop only our hub.
      writeFileSync(w.release, 'go\n');
      await stopHub(hub);
    }
  }, 240000);
}
