// #2896 AC5: the largest refusal each tool can send, as a stand-in Claude Code client (an error over about 11,000 characters keeps
// its first and last 5,000) and a stand-in Codex client (cut past 10,000 tokens) receive it through `deep mcp` on a fixture hub,
// is under 9,000 characters (README: The largest refusals).
import { afterAll, describe, expect, it } from 'vitest';
import {
  CLAUDE, CODEX, DOC, PLANT, REFUSAL_CHARS, call, cleanup, client, fmt, keeps, listTools, pageDocument, sizeReceived, tryWorld,
  type HubWorld, type Line, type Received,
} from './helpers.ts';

const TEST_MS = 1_800_000;

interface Refusal { tool: string; what: string; r: Received }
/**
 * Each tool's largest refusal this suite can make it send: for every tool `deep mcp` lists with a required field, the call with
 * every field left out (`missing_field`, which carries the tool's whole input schema, #1415); and deep_show's refusal of a whole
 * revision whose every item fails its check (each item's issue).
 */
async function refusals(w: HubWorld): Promise<{ refused: Refusal[]; problems: string[] }> {
  const refused: Refusal[] = [];
  const problems: string[] = [];
  const cc = client(w, CLAUDE);
  for (const t of await listTools(cc)) {
    const required = Array.isArray(t.inputSchema?.required) ? (t.inputSchema.required as string[]) : [];
    if (!required.length) continue;
    const r = await call(w, cc, t.name, {});
    const v = r.value as Line;
    if (!r.isError || v?.code !== 'missing_field') { problems.push(`${t.name} with every field left out isn't refused with missing_field: ${r.text.slice(0, 400)}`); continue; }
    refused.push({ tool: t.name, what: 'missing_field', r });
  }
  if (!refused.some((x) => x.tool === 'deep_drive')) problems.push('deep mcp sent no missing_field refusal for deep_drive');
  const bad = pageDocument();
  for (const item of Object.values(bad.items as Line)) (item as Line).bogus = 1;
  const r = await call(w, cc, 'deep_show', { doc: DOC.page, document: JSON.stringify(bad), include: ['issues'] }, 600_000);
  const v = r.value as Line;
  if (v?.outcome === 'presented') problems.push(`deep_show presented a revision whose every item has an unknown field: ${r.text.slice(0, 400)}`);
  else refused.push({ tool: 'deep_show', what: `${String(v?.code ?? v?.outcome ?? 'refusal')} of a whole revision whose 1,000 items each fail its check`, r });
  return { refused, problems };
}
/** AC5's failures: each names the tool, the code and its size as the client receives it. */
function overRefusal(refused: readonly Refusal[]): string[] {
  const out: string[] = [];
  for (const x of refused) {
    for (const spec of [CLAUDE, CODEX]) {
      const kept = keeps(spec, x.r);
      const n = kept.text.length;
      if (n >= REFUSAL_CHARS) out.push(`${x.tool}: its ${x.what} is ${fmt(n)} characters as the ${spec.label === 'codex' ? 'Codex' : 'Claude Code'} stand-in receives it (${kept.how}; ${fmt(sizeReceived(x.r).chars)} sent), not under ${fmt(REFUSAL_CHARS)}`);
    }
  }
  return out;
}

describe('#2896 AC5: the largest refusals', () => {
  afterAll(cleanup, 60_000);

  // AC5: "The largest refusal each tool can send, `missing_field` on `deep_drive` among them, is under 9,000 characters as the
  // client receives it (drafted from the 11,000 an error keeps). A planted refusal that carries a 12,000-character schema fails,
  // naming the code and its size"
  it('AC5 #2896.8a6ba5bb the largest refusal each tool can send, missing_field on deep_drive among them, is under 9,000 characters as each stand-in client receives it', async () => {
    const opened = await tryWorld([CLAUDE, CODEX]);
    try {
      expect(opened.error, 'the world opened').toBe('');
      const { refused, problems } = await refusals(opened.w!);
      console.log(`AC5 each refusal as sent: ${refused.map((x) => `${x.tool} ${x.what}: ${fmt(sizeReceived(x.r).chars)} characters, isError ${x.r.isError}`).join('; ')}`);
      expect([...problems, ...overRefusal(refused)], 'every refusal reaches both stand-ins under 9,000 characters (each failure names the tool, the code and its size)').toEqual([]);
    } finally {
      await cleanup();
    }
  }, TEST_MS);

  it(`AC5 #2896.8a6ba5bb (wrong program ${PLANT.schema12k}) a planted refusal that carries a 12,000-character schema fails, naming the code and its size`, async () => {
    const planted = await tryWorld([CLAUDE, CODEX], PLANT.schema12k);
    try {
      expect(planted.error, `the hub and deep mcp run with DEEP_HUB_PLANT=${PLANT.schema12k}`).toBe('');
      const { refused } = await refusals(planted.w!);
      const failures = overRefusal(refused);
      console.log(`AC5 ${PLANT.schema12k}: ${JSON.stringify(failures)}`);
      expect(failures.some((f) => f.includes('missing_field') && /\d+(,\d{3})* characters as the/.test(f)), `the planted refusal fails, naming missing_field and its size: ${JSON.stringify(failures)}`).toBe(true);
    } finally {
      await cleanup();
    }
  }, TEST_MS);
});
