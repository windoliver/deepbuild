// #111.AC1 A rule repeated in two agents' memory files becomes one shared rule with both sources; and Scope: the memory
// and instruction files of Claude Code, Codex, pi and Cursor, plus their transcripts, read into the wiki with sources.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { leaks } from '../356/checks.ts';
import { CANARIES, DATABASE_URL } from '../356/history.ts';
import { walk } from '../356/helpers.ts';
import {
  AGENTS, AGENT_WROTE, cleanup, claudeSession, codexSession, compile, CURSOR_ONLY, cursorSession, deep, lessons, memoryFile, memoryHome, NEAR, namesFile, piSession, PI_ONLY, projectMemory, put, rootOf, ruleClaims, shown, snapshot, sourcesOf, TWO, WIDE, type Mem,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const AC1 = '#111.fe2b4a16';

const fileAll = (m: Mem, rule: string, agents: readonly (typeof AGENTS)[number][]): string[] => {
  const held = ruleClaims(m, rule);
  const problems: string[] = [];
  if (held.length !== 1) problems.push(`"${rule}" is ${held.length} claims, not one: ${held.map((c) => c.page).join(', ')}`);
  for (const c of held) {
    if (c.page !== 'rules.md') problems.push(`"${rule}" is on ${c.page}, not rules.md`);
    if (c.json.proof !== agents.length) problems.push(`"${rule}" has proof ${c.json.proof}, not ${agents.length}`);
    if (sourcesOf(c).length !== agents.length) problems.push(`"${rule}" has ${sourcesOf(c).length} sources, not ${agents.length}`);
    for (const a of agents) if (!sourcesOf(c).some((s) => namesFile(s, memoryFile(m.h.home, a)))) problems.push(`"${rule}" has no source naming ${a}'s file`);
  }
  return problems;
};

describe(`${AC1} a rule repeated in two agents' memory files`, () => {
  it(`${AC1} a rule in Claude Code's and Codex's files is one claim on rules.md with both sources, proof 2; the rule that differs by one word stays its own claim`, async () => {
    const m = memoryHome({ agents: ['claude', 'codex'] });
    await compile(m);
    expect(fileAll(m, TWO, ['claude', 'codex'])).toEqual([]);
    // A compiler that merges similar rules loses this one; "every push" isn't "every commit".
    const near = ruleClaims(m, NEAR);
    expect(near.length, `"${NEAR}" stays a claim of its own`).toBe(1);
    expect(near[0]!.json.proof, 'and only Codex says it').toBe(1);
    expect(near[0]!.line, 'the near rule isn\'t the shared rule\'s line').not.toContain(TWO);
    // Each source resolves to its quote through the record.
    for (const s of sourcesOf(ruleClaims(m, TWO)[0]!)) {
      expect(s.quote, 'each source keeps the rule\'s exact words').toContain(TWO);
      if (s.at) {
        const read = await deep(m.h.home, ['read', s.at]);
        expect(read.code, `deep read ${s.at}: ${shown(read)}`).toBe(0);
        expect(read.stdout, `${s.at} holds the quote`).toContain(TWO);
      }
    }
  }, 900_000);

  it(`${AC1} re-reading adds no source and no claim; a third agent's file that later says it adds its source to the same claim`, async () => {
    const m = memoryHome({ agents: ['claude', 'codex'] });
    await compile(m);
    expect(fileAll(m, TWO, ['claude', 'codex']), 'after the first compile').toEqual([]);
    const pages = snapshot(m.wiki).get('rules.md');
    await compile(m);
    expect(snapshot(m.wiki).get('rules.md'), 'a second compile on unchanged files leaves rules.md as it was').toBe(pages);
    put(memoryFile(m.h.home, 'pi'), `# pi context\n\n- ${TWO}\n`);
    await compile(m);
    expect(fileAll(m, TWO, ['claude', 'codex', 'pi']), 'after pi says it too').toEqual([]);
  }, 900_000);

  it(`${AC1} the same rule across all four agents is one claim with four sources`, async () => {
    const m = memoryHome();
    await compile(m);
    expect(fileAll(m, WIDE, AGENTS)).toEqual([]);
  }, 900_000);
});

describe('Scope: every agent\'s files read into the wiki with sources', () => {
  it('Scope: each agent\'s own memory rule is a claim citing that agent\'s file: Claude Code, Codex, pi and Cursor; Cursor\'s front matter is no rule', async () => {
    const m = memoryHome();
    await compile(m);
    for (const [rule, agent] of [[TWO, 'claude'], [NEAR, 'codex'], [PI_ONLY, 'pi'], [CURSOR_ONLY, 'cursor']] as const) {
      const held = ruleClaims(m, rule);
      expect(held.length, `"${rule}" from ${agent}'s file is on a page`).toBe(1);
      expect(sourcesOf(held[0]!).some((s) => namesFile(s, memoryFile(m.h.home, agent))), `"${rule}" cites ${agent}'s file`).toBe(true);
    }
    expect(ruleClaims(m, 'alwaysApply').length, 'front matter isn\'t read as a rule').toBe(0);
  }, 900_000);

  it('Scope: a line you said in each agent\'s transcript is a claim citing your message, known from you; the same words from the assistant are not known from you', async () => {
    const m = memoryHome({ agents: ['claude'] });
    const said = { claude: 'the claude transcript fact is amber', codex: 'the codex transcript fact is birch', pi: 'the pi transcript fact is cobalt', cursor: 'the cursor transcript fact is damson' };
    claudeSession(m, m.api, { role: 'user', text: `Note this. remember: ${said.claude}.` }, { role: 'assistant', text: 'Noted.' });
    codexSession(m, m.api, { role: 'user', text: `Note this. remember: ${said.codex}.` }, { role: 'assistant', text: 'Noted.' });
    piSession(m, m.api, { role: 'user', text: `Note this. remember: ${said.pi}.` }, { role: 'assistant', text: 'Noted. remember: the pi assistant fact is ebony.' });
    cursorSession(m, m.api, { role: 'user', text: `Note this. remember: ${said.cursor}.` }, { role: 'assistant', text: 'Noted.' });
    await compile(m);
    const problems: string[] = [];
    for (const [agent, fact] of Object.entries(said)) {
      const [c] = ruleClaims(m, fact);
      if (!c) { problems.push(`${agent}'s transcript line "${fact}" is on no page`); continue; }
      if (c.json.known !== 'you') problems.push(`${agent}'s "${fact}" reads known ${c.json.known}, not you`);
      if (!sourcesOf(c).some((s) => String(s.at).startsWith('session:'))) problems.push(`${agent}'s "${fact}" cites no session message: ${JSON.stringify(c.json.sources)}`);
    }
    for (const c of ruleClaims(m, 'the pi assistant fact is ebony')) if (c.json.known === 'you') problems.push('the assistant\'s words read as known from you');
    expect(problems).toEqual([]);
  }, 900_000);

  it('Invariant 1: a rule an agent\'s own memory feature wrote still shows its source, and never reads as from you or your decision', async () => {
    const m = memoryHome();
    claudeSession(m, m.api, { role: 'user', text: 'hello there' }, { role: 'assistant', text: 'Hello.' });
    projectMemory(m, m.api);
    await compile(m);
    const [c] = ruleClaims(m, AGENT_WROTE);
    expect(c, `"${AGENT_WROTE}" from Claude Code's project memory is on a page`).toBeDefined();
    expect(sourcesOf(c!).length, 'it shows its source').toBeGreaterThan(0);
    expect(['you', 'decision'], `it reads known ${c!.json.known}`).not.toContain(c!.json.known);
    // And in the list you keep or remove from: the wrong program drops the source there.
    const listed = (await lessons(m)).filter((l) => l.text.includes(AGENT_WROTE) || l.sources.some((s) => String(s.quote).includes(AGENT_WROTE)));
    for (const l of listed) expect(l.sources.length, 'a lesson from it shows its source').toBeGreaterThan(0);
  }, 900_000);

  it('Invariant: no credential value from any agent\'s memory file reaches a page, the log, the index, the ledger or the list; each file\'s other rules do', async () => {
    const line = `\n- Deploy with STRIPE_API_KEY=${CANARIES.stripe} and GITHUB_TOKEN=${CANARIES.github}\n- Connect through ${DATABASE_URL}\n`;
    const m = memoryHome({ extra: { claude: line, codex: line, pi: line, cursor: line } });
    await compile(m);
    for (const rule of [TWO, PI_ONLY, CURSOR_ONLY]) expect(ruleClaims(m, rule).length, `"${rule}" is on a page, so the sweep isn't of an empty wiki`).toBe(1);
    const root = rootOf(m.h.home);
    const files = new Map<string, Buffer | string>();
    for (const f of walk(root)) {
      const rel = f.slice(root.length + 1);
      if (/^(evidence|jobs)\//.test(rel)) continue;
      try { if (statSync(f).isFile()) files.set(rel, readFileSync(f)); } catch { /* a socket */ }
    }
    expect(existsSync(`${root}/ledger.db`), 'the sweep reaches the ledger').toBe(true);
    const listed = await deep(m.h.home, ['memory', '--json']);
    expect(listed.code, `deep memory --json: ${shown(listed)}`).toBe(0);
    files.set('deep memory --json', listed.stdout);
    expect(leaks(files as Map<string, Buffer>, { ...CANARIES, databaseUrl: DATABASE_URL })).toEqual([]);
  }, 900_000);
});
