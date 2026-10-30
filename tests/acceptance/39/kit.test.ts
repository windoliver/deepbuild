// AC4, AC20, AC23: the adapter kit in packages/conformance, the app's gap in the facts, generated types.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kits, runKit, shippedFill, type Fill, type Kit } from '../../../packages/conformance/src/index.ts';
import { AC, FACTS, parseObject, REPO } from './helpers.ts';

const THREAD_B = '019a0000-0000-7000-8000-00000000000b';
const adapterKit = (): Kit => kits().find((k) => k.name === 'adapter@1')!;
const fillOf = (o?: Record<string, unknown>): Fill => (shippedFill as (a: string, o?: unknown) => Fill)('codex', o);

describe(`${AC[20]} The twin that delivers thread A's answer to thread B on one daemon fails the kit with "answer delivered to another session", naming both sessions, while the adapter passes; an answerPermission case whose fixture payload lacks the request's ID reads INVALID, "declared answerPermission, never reached", never passed`, () => {
  it(`${AC[20]} the Codex adapter passes; the twin (a deliver that lands in another thread) fails deliver/one-owner-per-session, naming both sessions`, () => {
    const clean = runKit(adapterKit(), fillOf(), { headless: true });
    const permissionCase = clean.cases.find((c) => /permission/i.test(c.id));
    expect(permissionCase?.outcome, `${AC[20]} the adapter's answerPermission case is a real permission reply, signed: ${JSON.stringify(permissionCase)}`).toBe('PASS');
    expect(permissionCase?.reached?.flags ?? [], `${AC[20]} that reached answerPermission`).toContain('answerPermission');
    expect(clean.cases.filter((c) => c.outcome !== 'PASS' && !/listed unsupported/.test(c.message)).map((c) => `${c.id}: ${c.outcome} ${c.message}`), `${AC[20]} the adapter passes the kit`).toEqual([]);
    const fill = fillOf();
    const twin: Fill = { ...fill, deliver: (_answer, session) => ({ session, sign: `delivered:allow:${THREAD_B}` }) };
    const report = runKit(adapterKit(), twin, { headless: true });
    const line = report.cases.find((c) => c.outcome === 'FAIL' && c.message.includes('answer delivered to another session'));
    expect(line, `${AC[20]} the twin fails with "answer delivered to another session": ${JSON.stringify(report.cases.filter((c) => c.outcome !== 'PASS').map((c) => [c.id, c.message]))}`).toBeDefined();
    expect(line!.message, `${AC[20]} naming thread B, where it landed`).toContain(THREAD_B);
    expect(line!.message, `${AC[20]} and thread A, whose answer it was: ${line!.message}`).toMatch(/\b(?:session|thread)\b.*[0-9a-f-]{8,}.*[0-9a-f-]{8,}/);
  });
  it(`${AC[20]} a fixture PermissionRequest with no request ID never reaches answerPermission: INVALID, naming it, never PASS`, () => {
    const report = runKit(adapterKit(), fillOf({ permissionFixture: { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'git push origin main' } } }), { headless: true });
    const line = report.cases.find((c) => /permission/i.test(c.id));
    expect(line?.outcome, `${AC[20]} reads INVALID: ${JSON.stringify(line)}`).toBe('INVALID');
    expect(line?.message, `${AC[20]}`).toContain('declared answerPermission, never reached');
  });
});

describe(`${AC[23]} Adapter types are generated from Codex's published hook schemas`, () => {
  it(`${AC[23]} a generated module under packages/adapters says so and names the source, with a type for each of the twelve events' payloads and the output shapes the schemas define`, () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const files = walk(join(REPO, 'packages/adapters/src')).filter((f) => f.endsWith('.ts'));
    const generated = files.find((f) => { const head = readFileSync(f, 'utf8').slice(0, 800); return /generated/i.test(head) && head.includes('codex-rs/hooks/schema/generated'); });
    expect(generated, `${AC[23]} a generated file naming codex-rs/hooks/schema/generated in its header, among ${files.join(', ')}`).toBeDefined();
    const text = readFileSync(generated!, 'utf8');
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt', 'SessionEnd']) {
      expect(text, `${AC[23]} a type for ${event}`).toContain(event);
    }
    expect(text, `${AC[23]} PermissionRequest's behavior, from its schema`).toMatch(/['"]allow['"]\s*\|\s*['"]deny['"]/);
  });
});

describe(`${AC[4]} The same hooks hold a stop in the Codex app; if they don't on a given app version, that gap is written down with the version and the upstream issue (openai/codex#33992, #47607)`, () => {
  it(`${AC[4]} either a desktop corpus session records a held stop, or the facts write down the gap with its version and both upstream issues. BLOCKED until the app's live run: app.live.test.ts`, () => {
    const corpus = join(REPO, 'adapters/corpus/codex');
    const recorded = FACTS.versions.flatMap((v) => (existsSync(join(corpus, v)) ? readdirSync(join(corpus, v)).map((s) => join(corpus, v, s)) : []))
      .filter((d) => { const s = parseObject(readFileSync(join(d, 'session.json'), 'utf8')); return s?.surface === 'desktop' && /stop-hold|held/.test(String(s?.scenario)); });
    const facts = readFileSync(join(REPO, 'adapters/codex.facts.json'), 'utf8');
    const gap = facts.includes('33992') && facts.includes('47607') && /app/i.test(facts) && FACTS.versions.some((v) => new RegExp(`${v.replaceAll('.', '\\.')}[^"]*(33992|47607)|(33992|47607)[^"]*${v.replaceAll('.', '\\.')}`).test(facts));
    expect(recorded.length > 0 || gap, `${AC[4]} no recorded desktop stop hold, and no gap in adapters/codex.facts.json naming its version and openai/codex#33992 and #47607`).toBe(true);
  });
});
