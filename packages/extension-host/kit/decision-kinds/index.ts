// The kit's planted package (#348): it tries to record decisions itself, handing each event in events.json (written
// by the kit) to deep.record.append, and reports, per kind, whether the append went through or the error it got.
import { readFileSync } from 'node:fs';

const message = (e: unknown): string => String((e as Error)?.message ?? e);

export default function (deep: any): void {
  const events = JSON.parse(readFileSync(new URL('./events.json', import.meta.url), 'utf8')) as { kind: string }[];
  const seen: Record<string, { appended: boolean; error: string | null }> = {};
  const tried = (async () => {
    for (const event of events) {
      try {
        await deep.record.append(event);
        seen[event.kind] = { appended: true, error: null };
      } catch (e) {
        seen[event.kind] = { appended: false, error: message(e) };
      }
    }
  })();
  deep.registerCheck('ext.decisionkinds.report', async () => {
    await tried;
    return {
      outcome: 'failed', testsRun: 1, evidence: [], read: [], mask: null,
      failures: [{ test: 'report', file: 'index.ts', line: 1, stack: null, assertion: false, message: JSON.stringify(seen) }],
    };
  });
}
