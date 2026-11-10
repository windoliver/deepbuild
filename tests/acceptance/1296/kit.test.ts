// #1296 AC5: the conformance kit holds a planted adapter that sends a needed block as stdout on a PostCompact hook,
// and one that sends it as stderr on exit 0, and fails each, naming the event. The kit is the conformance package's
// adapter@1 kit (`kits()`, its public entry), run in-process with `runKit`, headless, as #18's kit suite runs it. The
// planted adapters are among the kit's own fakes (`kit.fakes`), by the names README gives. The shipped Claude Code
// adapter (`shippedFill`) passes every case a planted adapter fails, so the failure is the plant's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { kits, runKit, shippedFill } from '../../../packages/conformance/src/index.ts';
import type { Kit, Report } from '../../../packages/conformance/src/index.ts';
import { AC5, HOOK_EVENTS, namesEvent } from './helpers.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
/** The registry name of the shipped Claude Code adapter: its facts' `agent` field. */
const AGENT = String((JSON.parse(readFileSync(join(REPO, 'adapters', 'claude-code.facts.json'), 'utf8')) as { agent: string }).agent);

function adapterKit(): Kit {
  const kit = kits().find((k) => k.name === 'adapter@1');
  if (!kit) throw Error('kits() ships no adapter@1 kit');
  return kit;
}
const listed = (report: Report): string => report.cases.map((c) => `${c.outcome} ${c.id}${c.message ? `: ${c.message}` : ''}`).join('\n');

/** Each planted adapter, and the event its failure must name (undefined: whichever hook event it sent the block on). */
const PLANTED: { name: string; how: string; event?: string }[] = [
  { name: 'block-as-postcompact-stdout', how: 'sends a needed block as plain stdout on a PostCompact hook', event: 'PostCompact' },
  { name: 'block-as-stderr-exit-0', how: 'sends a needed block as stderr on exit 0' },
];

describe(`${AC5} the conformance kit holds a planted adapter that sends a needed block as stdout on PostCompact or as stderr on exit 0, and fails it, naming the event`, () => {
  for (const p of PLANTED) {
    it(`${AC5} the kit holds ${p.name}, which ${p.how}; the kit fails it naming ${p.event ?? 'the hook event'}, and the shipped Claude Code adapter passes those cases`, () => {
      const kit = adapterKit();
      const fake = kit.fakes.find((f) => f.name === p.name);
      expect(fake, `adapter@1 holds a planted adapter named ${p.name}; its fakes are ${kit.fakes.map((f) => f.name).join(', ')}`).toBeDefined();
      const report = runKit(kit, fake!.fill, { headless: true });
      const failing = report.cases.filter((c) => c.outcome === 'FAIL');
      expect(failing.length, `adapter@1 fails ${p.name}; the run read:\n${listed(report)}`).toBeGreaterThan(0);
      const naming = failing.filter((c) => (p.event ? namesEvent(c.message, p.event) : HOOK_EVENTS.some((e) => namesEvent(c.message, e))));
      expect(naming.map((c) => c.id), `a failing case's message names ${p.event ?? 'the hook event the block went out on'}; the failures read: ${failing.map((c) => `${c.id}: ${c.message}`).join(' | ')}`).not.toEqual([]);
      const shipped = runKit(kit, shippedFill(AGENT), { headless: true });
      for (const c of naming) {
        expect(shipped.cases.find((r) => r.id === c.id)?.outcome, `the shipped Claude Code adapter passes ${c.id}, the case ${p.name} fails; the run read:\n${listed(shipped)}`).toBe('PASS');
      }
    }, 120_000);
  }
});
