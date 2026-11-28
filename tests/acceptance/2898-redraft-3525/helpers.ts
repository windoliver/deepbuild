// What #2898's AC3 redraft under #3525 needs beyond tests/acceptance/2898/helpers.ts, which it imports unchanged
// (REDRAFT.md). Two things there can't hold after #3525, so they are adapted here, and nothing else is copied:
//
// - The table. #2898's `TABLE` is the issue's drafted table, with `deep_kinds` open-world only. #3525 lists it
//   read-only and idempotent, still open-world and not destructive; every other row is #2898's.
// - The forms of `deep_job`. #2898's `forms` knows no form of `deep_job` (it is not a read), so `readOnlyFailures`
//   given `deep_job` calls nothing and can't name an asset. After #3525 the fetch is `deep_job`'s form, called as
//   #3525's blind suite fixed it (tests/acceptance/3525/README.md, The new form): `{op: "fetch", library, id}`.
//   `readOnlyFailures` below is #2898's line for line, but for the forms it reads (`formsOf`) and the selector it
//   checks the schema against (`SELECTORS`, which adds `deep_job`'s `op`).
// - The forms of `deep_kinds`: `formsOf` leaves out the null fields the listed schema no longer holds (below).
// - `drift`, which reads `TABLE`: #2898's line for line over the table here.
import {
  HINTS, SELECTORS as SELECTORS_2898, TABLE as TABLE_2898, brief, forms, gained, lastPos, said, t26,
  type FormCtx, type Hint, type Hints, type Line, type Rig,
} from '../2898/helpers.ts';

/** #2898's table with #3525's row for deep_kinds: read-only, idempotent, open-world, not destructive. */
export const TABLE: Readonly<Record<string, Hints>> = {
  ...TABLE_2898,
  deep_kinds: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};
export const tableSays = (hint: Hint): string[] => Object.keys(TABLE).filter((t) => TABLE[t]![hint]).sort();

/** #2898's `drift`, line for line, over the table above: one line per tool and hint where the listing differs. */
export function drift(server: string, tools: readonly Line[]): string[] {
  const out: string[] = [];
  for (const tool of tools) {
    const want = TABLE[String(tool.name)];
    if (!want) { out.push(`${server}: ${String(tool.name)} is in no row of the table`); continue; }
    for (const hint of HINTS) {
      const got = (tool.annotations as Line | undefined)?.[hint];
      if (got !== want[hint]) out.push(`${server}: ${String(tool.name)} ${hint} lists ${got === undefined ? 'nothing' : JSON.stringify(got)}, the table ${want[hint]}`);
    }
  }
  return out;
}

/** The field that picks a form: #2898's, and deep_job's `op`. */
export const SELECTORS: Readonly<Record<string, string>> = { ...SELECTORS_2898, deep_job: 'op' };

/**
 * Every form a tool's schema takes: #2898's `forms`, and for deep_job the fetch (#3525's new form), with the asset
 * `extra` names (`library`, `id`). Fields the form doesn't need are left out (#3525's README: a nullable field left out
 * reads as null). Another op deep_job's schema lists is named by `formsMissed` as a form this suite doesn't call.
 */
export function formsOf(tool: string, c: FormCtx, extra: Line = {}, schema?: Line): { label: string; args: Line }[] {
  if (tool === 'deep_job') return [{ label: 'op: fetch', args: { op: 'fetch', library: extra.library ?? null, id: extra.id ?? null } }];
  const list = forms(tool, c, extra);
  if (tool !== 'deep_kinds') return list;
  // #2898's deep_kinds forms send every field of the base's schema, null where the form doesn't set it, the fetch's
  // `library`, `id`, `pack` and `asset` included. #3525 takes those fields out of deep_kinds' schema, and `check`
  // (packages/hub/src/tools.ts) refuses a field the schema doesn't list (`unlisted_field`), null or not, so every
  // lookup would be refused and prove nothing. A null field the listed schema doesn't hold is left out (#3525's
  // README: Forms, "kept to the fields the listed schema holds"); on the base every one is listed, so nothing changes.
  const listed = (schema?.properties ?? undefined) as Line | undefined;
  if (!listed) return list;
  return list.map((f) => ({ ...f, args: Object.fromEntries(Object.entries(f.args).filter(([k, v]) => v !== null || k in listed)) }));
}

/** The values a tool's form selector lists that the forms table misses (#2898's, over SELECTORS above). */
export function formsMissed(tool: string, schema: Line | undefined, listed: readonly { args: Line }[]): string[] {
  const field = SELECTORS[tool];
  if (!field) return [];
  const values = ((schema?.properties as Line | undefined)?.[field]?.enum ?? []) as unknown[];
  return values.filter((v) => !listed.some((f) => f.args[field] === v)).map((v) => `${tool}'s ${field}: ${JSON.stringify(v)}`);
}

/** #2898's `readOnlyFailures`, line for line, over `formsOf` and `formsMissed` above. */
export async function readOnlyFailures(rig: Rig, tools: readonly string[], c: FormCtx, extra: Line = {}): Promise<{ failures: string[]; calls: string[] }> {
  const failures: string[] = [];
  const calls: string[] = [];
  for (const tool of tools) {
    const list = formsOf(tool, c, extra, rig.schema(tool));
    if (!list.length) failures.push(`${tool} is listed read-only and this suite knows no form of it to call`);
    failures.push(...formsMissed(tool, rig.schema(tool), list).map((m) => `${m} is a form this suite doesn't call`));
    for (const form of list) {
      const since = await lastPos(rig.events);
      const o = await rig.call(tool, form.args);
      await t26.sleep(500);
      const got = await gained(rig.events, since);
      calls.push(`${tool} ${form.label}: ${o.isError ? 'refused' : 'answered'} ${brief(o.value, 160)}`);
      if (got.length) failures.push(`${tool} (${form.label}, ${brief(form.args, 240)}) changed the record: ${said(got)}`);
    }
  }
  return { failures, calls };
}
