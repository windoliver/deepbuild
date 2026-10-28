// #63 AC5: a finding that quotes a tool result inside a transcript is marked outside content, never as your words.
// Each finding keeps how its source was known, and a transcript source keeps its message's role (Scope).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseClaimLine } from '../../../packages/record/src/index.ts';
import { session, tag } from './corpus.ts';
import { AC, cleanup, norm, readSlice, type Line } from './helpers.ts';
import { openWorld, runReading } from './world.ts';

afterAll(cleanup);

function claimLines(dir: string): Line[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return claimLines(path);
    if (!e.name.endsWith('.md')) return [];
    return readFileSync(path, 'utf8').split('\n').map((l) => parseClaimLine(l)).filter((c): c is NonNullable<typeof c> => c !== undefined).map((c) => c.record as Line);
  });
}

describe(`AC5 ${AC[5]} a finding quoting a tool result inside a transcript is marked outside content, never as your words`, () => {
  it("AC5 the slice marks the tool's result; the finding quoting a fetch's result is outside content, one quoting a command's result is never yours, and yours is yours", async () => {
    const fetched = 'the docs say to run `make setup` before the first start';
    const commanded = 'SETUP.txt says the api reads `DATABASE_URL` at start';
    const s = session(5000, {
      project: 'api', count: 4, at: { 3: 'fetch', 4: 'bash' },
      texts: { 3: `${tag(5000, 3)} remember: ${fetched}.`, 4: `${tag(5000, 4)} remember: ${commanded}.` },
    });
    const yours = `${s.handle}#m2`;
    const fetch = `${s.handle}#m3`;
    const command = `${s.handle}#m4`;
    const w = await openWorld();
    try {
      await w.seed([s]);
      const slice = readSlice(w.root, s.handle);
      const entry = (at: string) => (slice.messages ?? []).find((m) => m.at === at);
      expect(entry(fetch), `the slice lists ${fetch}`).toBeDefined();
      expect(entry(fetch)!.tool, "the slice says which tool's result m3 is").toBe('WebFetch');
      expect(entry(fetch)!.outside, "a fetch's result is outside content in the slice").toBe(true);
      expect(entry(command)!.tool, "the slice says which tool's result m4 is").toBe('Bash');
      expect(entry(yours)!.tool, 'your own message is no tool result').toBeUndefined();
      expect(entry(yours)!.outside, 'your own message is not outside content').toBe(false);

      const { result } = await runReading(w, { kind: 'install' });
      const citeOf = (at: string) => result.findings.flatMap((f) => f.cites).find((c) => c.at === at);
      for (const at of [yours, fetch, command]) {
        expect(citeOf(at), `a finding cites ${at}`).toBeDefined();
        expect(typeof citeOf(at)!.role, `the transcript source ${at} keeps its message's role`).toBe('string');
      }
      expect(citeOf(fetch)!.known, "the finding quoting the fetch's result is marked outside content").toBe('outside');
      expect(citeOf(command)!.known, "the finding quoting the command's result never reads as your words").not.toBe('you');
      expect(citeOf(yours)!.known, 'the finding quoting your message is yours').toBe('you');

      const lines = claimLines(join(w.root, 'wiki'));
      const lineQuoting = (quote: string) => lines.find((l) => ((l.sources ?? []) as Line[]).some((src) => norm(String(src.quote)).includes(norm(quote))));
      expect(lineQuoting(fetched), 'the wiki holds the fetched claim').toBeDefined();
      expect(lineQuoting(fetched)!.known, 'its wiki line is marked outside content').toBe('outside');
      expect(lineQuoting(commanded)!.known, "the command's claim never reads as yours on the wiki").not.toBe('you');
    } finally {
      await w.close();
    }
  }, 900_000);
});
