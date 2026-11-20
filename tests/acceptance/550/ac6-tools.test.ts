// AC6 #550.8e0f54ea: deep_kinds lists net@1 with its fields, defaults and check kinds in a build with the net module
// and marks it unavailable with module_missing in one without; deep_run runs net.desync on the gallery's two-player
// piece and returns the planted step and field; and no tool opens a connection or joins a match, checked against the
// tool list
//
// deep_kinds is #412's `deep_kinds` call of `deep-show run` (`op: "list"` with `registry: "kind@1"`, paged by its
// cursors; `op: "gallery"`; `op: "read"`), in the `full` build, which holds the net module, and the `core` build, which
// holds neither logic nor net. net@1's entry lists its check kinds as `check_kinds` (README: deep_kinds). deep_run's
// check kind is a claim's verdict (`{call: "verdict", claim}`, as #1939's suite reads deep_run's checks): the agent's
// claim on the gallery's two-player piece, its one requirement `{kind: "net.desync", seed: 550}`; the row's `results`
// carry the planted change and the net.desync report (README: deep_run's net.desync). The tool list is `deep mcp`'s
// tools/list (#26), read as #412's suite reads it. Wrong programs it fails: the merge base (net@1 lists no check kinds,
// a build without net doesn't list it, the gallery holds no two-player piece, net.desync isn't run); a net.desync that
// passes without naming what it planted, or names another step or field; a tool that joins.
import { describe, expect, it } from 'vitest';
import {
  AC, CORE, FULL, TIMEOUT, galleryDocs, isObject, kindsEntries, none, obj, propertyNames, putGalleryPrograms, show, toolList, useBuilds, useChildren, useTemp, verdictRow,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL, CORE] });
useChildren();
const temp = useTemp();

/** net@1's fields and the defaults the design gives them (Net `net@1`: Fields). */
const DEFAULTS: Record<string, number | undefined> = { relay: undefined, players: undefined, step_rate: 60, delay: 2, window: 8, hash_every: 60, timeout: 5 };
const CHECK_KINDS = ['net.rollback', 'net.desync', 'net.budget'];
const netOf = (entries: JsonObject[]): JsonObject | undefined => entries.find((e) => e['name'] === 'net@1');

describe(`${AC[6]} net in the tools`, () => {
  it(`${AC[6]} deep_kinds lists net@1 with its fields, defaults and check kinds in the full build, and marks it unavailable with module_missing in the core build`, async () => {
    const f: string[] = [];
    const full = netOf(await kindsEntries(builds.show(FULL), temp(), 'kind@1', 'AC6 the full build'));
    if (!full) f.push('AC6: the full build\'s deep_kinds lists no net@1');
    else {
      if (full['available'] !== true) f.push(`AC6: the full build lists net@1 as available ${String(full['available'])}`);
      const fields = new Map((Array.isArray(full['fields']) ? full['fields'] : []).filter(isObject).map((x) => [String(x['name']), x]));
      for (const [name, value] of Object.entries(DEFAULTS)) {
        const field = fields.get(name);
        if (!field) f.push(`AC6: net@1 lists no field ${name}; its fields are ${[...fields.keys()].join(', ')}`);
        else if (value !== undefined && field['default'] !== value) f.push(`AC6: net@1's ${name} defaults to ${show(field['default'])}, not ${value}`);
      }
      const kinds = (Array.isArray(full['check_kinds']) ? full['check_kinds'] : []).map((k) => (isObject(k) ? String(k['kind'] ?? k['name']) : String(k)));
      for (const k of CHECK_KINDS) if (!kinds.includes(k)) f.push(`AC6: net@1 lists the check kinds ${JSON.stringify(full['check_kinds'] ?? null)}, without ${k}`);
    }
    const core = netOf(await kindsEntries(builds.show(CORE), temp(), 'kind@1', 'AC6 the core build'));
    if (!core) f.push('AC6: the core build, which holds no net module, doesn\'t list net@1 at all');
    else if (core['available'] !== false || core['code'] !== 'module_missing') f.push(`AC6: the core build lists net@1 as available ${String(core['available'])} with code ${String(core['code'])}, not unavailable with module_missing`);
    none(f, 'deep_kinds lists net@1 where the net module is and marks it missing where it isn\'t');
  }, TIMEOUT);

  it(`${AC[6]} deep_run runs net.desync on the gallery's two-player piece and returns the planted step and field, and no tool on the tool list opens a connection or joins a match`, async () => {
    const evidence = temp();
    const pieces = (await galleryDocs(builds.show(FULL), evidence, 'AC6')).filter((e) => {
      const items = isObject(e.doc?.['items']) ? Object.values(e.doc['items']).filter(isObject) : [];
      return items.some((i) => i['kind'] === 'net@1' && (!isObject(i['params']) || (i['params']['players'] ?? 2) === 2));
    });
    expect(pieces.map((p) => p.title), 'the gallery holds a two-player piece: an example whose document has a net@1 item for 2 players').not.toEqual([]);
    const piece = pieces[0]!;
    const doc = typeof piece.doc!['id'] === 'string' ? piece.doc!['id'] : '01JB550G000000000000000001';
    putGalleryPrograms(evidence);
    const row = await verdictRow(builds.show(FULL), evidence, doc, { ...piece.doc!, id: doc }, { kind: 'net.desync', seed: 550 }, 'AC6 deep_run net.desync');
    const f: string[] = [];
    if (row['result'] !== 'PASS') f.push(`AC6: net.desync on the gallery's two-player piece reads ${String(row['result'])}, not PASS: ${show(row, 2000)}`);
    const results = (Array.isArray(row['results']) ? row['results'] : []).filter(isObject);
    const named = results.filter((r) => isObject(r['planted']) && isObject(r['desync']));
    if (!named.length) f.push(`AC6: net.desync's row returns no planted change with its net.desync report (results: [{planted, desync}]): ${show(row, 2000)}`);
    for (const r of named) {
      const planted = obj(r['planted'], 'the planted change');
      const desync = obj(r['desync'], 'its net.desync');
      if (typeof planted['step'] !== 'number' || typeof planted['field'] !== 'string') f.push(`AC6: the planted change names no step and field: ${show(planted)}`);
      else if (desync['first_step'] !== planted['step'] || desync['field'] !== planted['field']) f.push(`AC6: net.desync names step ${show(desync['first_step'])} and field ${show(desync['field'])}, where it planted step ${planted['step']} and field ${planted['field']}`);
    }
    // The tools that run it: deep mcp's list, where no tool opens a connection or joins a match.
    const tools = toolList(temp());
    expect(tools.map((t) => t.name), 'deep mcp lists deep_show, deep_run and deep_kinds').toEqual(expect.arrayContaining(['deep_show', 'deep_run', 'deep_kinds']));
    const joins = /join|relay|socket|connect|lobby|peer|^match(?:_id)?$/i;
    for (const t of tools) {
      if (joins.test(t.name)) f.push(`AC6: the tool ${t.name} is named for joining or connecting`);
      for (const p of propertyNames(t.inputSchema)) if (joins.test(p)) f.push(`AC6: ${t.name} takes ${p}, an input that names a relay, a match or a connection`);
    }
    none(f, 'deep_run\'s net.desync returns the step and field it planted, and no tool on the list opens a connection or joins a match');
  }, TIMEOUT);
});
