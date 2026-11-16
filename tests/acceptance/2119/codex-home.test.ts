// #2119 acceptance (README.md), the third criterion: the Codex health texts and the trust read name the Codex home setup
// wrote in. Written first and blind, from the issue, the design and the base commit. `deep setup` runs as a child
// process of the built CLI with CODEX_HOME naming a folder of the test's own; then, with no CODEX_HOME, `deep doctor
// --json` runs before and after the Stop entry's timeout is edited in that folder, and fixtures/hub-reads.mjs calls
// what the hub reads of Codex through its built modules: the relations and readings its health reports, and whether
// it reads a project as trusted. A failure on a wrong program is the expect below; a test that can't set that up
// throws BLOCKED, and never passes or skips.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { child, cleanup, deep, homeIn, items, needs, plain, script, standInHook, tempFolder, type Item } from './helpers.ts';

afterAll(cleanup);

/** Every absolute path a text names whose last part is Codex's hooks.json or config.toml. */
const codexFiles = (text: string): string[] => [...text.matchAll(/\/[^\s'"`]*\/(?:hooks\.json|config\.toml)/g)].map((m) => m[0]);
type Json = { [key: string]: unknown };

test("#2119.6d54a255 the Codex health texts and the trust read name the Codex home setup wrote in: with setup run under CODEX_HOME set to another folder and the Stop entry's timeout edited there, doctor's texts and the hub's relations, run with no CODEX_HOME, name that folder's hooks.json or config.toml, and a project trusted in that folder's config.toml reads as trusted", async () => {
  needs();
  const folder = tempFolder();
  const home = homeIn(folder);
  const root = join(home, '.deepbuild');
  const codexHome = join(folder, 'codex');
  const defaultHome = join(home, '.codex');
  const project = join(folder, 'project');
  mkdirSync(codexHome);
  mkdirSync(project);
  const o = child(folder, home, { nodePath: standInHook(folder).nodePath });
  const hooksFile = join(codexHome, 'hooks.json');
  const configFile = join(codexHome, 'config.toml');

  const setup = await deep({ ...o, codexHome }, 'setup');
  // Given: setup wrote Codex's entries and its MCP server in that folder, and the default home has nothing.
  let hooks: Json | undefined;
  try { hooks = JSON.parse(readFileSync(hooksFile, 'utf8')) as Json; } catch { /* none, or not JSON: BLOCKED below */ }
  const stop = ((hooks?.hooks as Json | undefined)?.Stop as { hooks: Json[] }[] | undefined)?.flatMap((g) => g.hooks).filter((h) => /deep-hook/.test(String(h.command))) ?? [];
  const config = existsSync(configFile) ? readFileSync(configFile, 'utf8') : '';
  if (stop.length !== 1 || !config.includes('[mcp_servers.deep]\n') || existsSync(defaultHome)) throw Error(`BLOCKED: setup with CODEX_HOME=${codexHome} didn't leave one Stop entry of DeepBuild's in ${hooksFile} and its MCP server in ${configFile}, with nothing in ${defaultHome}\n${setup.shown}`);

  const before = await deep(o, 'doctor', '--json');
  // The Stop entry's timeout edited there, so the entry isn't what setup wrote and the slow lane no longer fits it.
  stop[0]!.timeout = 60;
  writeFileSync(hooksFile, `${JSON.stringify(hooks, null, 2)}\n`);
  // That folder's config.toml: a tool_timeout_sec under DeepBuild's MCP server too short to wait in, which breaks the
  // one relation whose text names config.toml (README), and the project trusted, as Codex keeps a trust answer.
  writeFileSync(configFile, `${config.replace('[mcp_servers.deep]\n', '[mcp_servers.deep]\ntool_timeout_sec = 5\n')}\n[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n`);
  const after = await deep(o, 'doctor', '--json');
  const hub = await script<{ relations: { name: string; text: string }[]; readings: string[]; trusted: boolean }>('hub-reads.mjs', [root, project], home);

  // Each text, by where it comes from: doctor's Codex items, each with its evidence and fix, and the hub's.
  const doctorTexts = (r: Awaited<ReturnType<typeof deep>>, item?: string) => items(r).filter((i: Item) => i.agent === 'codex' && (!item || i.item === item)).map((i) => `${i.evidence}\n${i.fix}`);
  const texts: [string, string[], string][] = [
    ["doctor's codex.hooks, before the edit", doctorTexts(before, 'codex.hooks'), 'hooks.json'],
    ["doctor's codex.hooks, after the edit", doctorTexts(after, 'codex.hooks'), 'hooks.json'],
    ["doctor's timing.codex_slow_lane, after the edit", doctorTexts(after, 'timing.codex_slow_lane'), 'hooks.json'],
    ["doctor's timing.codex_deep_ask, after the edit", doctorTexts(after, 'timing.codex_deep_ask'), 'config.toml'],
    ["the hub's relation slow lane", hub.out.relations.filter((r) => r.name === 'slow lane').map((r) => r.text), 'hooks.json'],
    ["the hub's relation deep_ask", hub.out.relations.filter((r) => r.name === 'deep_ask').map((r) => r.text), 'config.toml'],
    ["the hub's readings of the entries", hub.out.readings, 'hooks.json'],
  ];
  const shown = (path: string) => (path.startsWith(codexHome + sep) ? `<that folder>${path.slice(codexHome.length)}` : path.startsWith(defaultHome + sep) ? `<the default home>${path.slice(defaultHome.length)}` : path);
  const named = (list: string[]) => [...new Set(list.flatMap(codexFiles))];
  const says = (list: string[], file: string) => {
    const paths = named(list);
    if (!list.length) return 'no such text';
    return paths.includes(join(codexHome, file)) && paths.every((p) => p.startsWith(codexHome + sep)) ? `names <that folder>/${file}` : `names ${paths.map(shown).join(', ') || 'no hooks.json or config.toml'}`;
  };
  // And every other Codex text, of doctor's or the hub's, that names a hooks.json or config.toml.
  const everyText = [...doctorTexts(before), ...doctorTexts(after), ...hub.out.relations.map((r) => r.text), ...hub.out.readings];
  const elsewhere = named(everyText).filter((p) => !p.startsWith(codexHome + sep)).map(shown);
  const seen = {
    ...Object.fromEntries(texts.map(([where, list, file]) => [where, says(list, file)])),
    'a hooks.json or config.toml any Codex text names outside that folder': elsewhere,
    'the hub reads the project trusted in that config.toml as trusted': hub.out.trusted,
  };
  const want = {
    ...Object.fromEntries(texts.map(([where, , file]) => [where, `names <that folder>/${file}`])),
    'a hooks.json or config.toml any Codex text names outside that folder': [],
    'the hub reads the project trusted in that config.toml as trusted': true,
  };
  const read = [
    `that folder: ${codexHome}; the default home: ${defaultHome}; the project: ${project}`,
    ...texts.flatMap(([where, list]) => list.map((text) => `${where}: ${text.replaceAll('\n', ' | ')}`)),
  ].join('\n');
  expect(seen, `The Codex texts doctor and the hub gave with no CODEX_HOME, setup having written in ${codexHome}:\n${plain(read)}\n(end of the texts)`).toEqual(want);
}, 600_000);
