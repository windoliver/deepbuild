import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { factsDrift } from '../../../packages/adapters/src/index.ts';
import type { Schema } from '../../../packages/contracts/src/index.ts';
import { codexFacts, FIXTURES, fixtureSet, getAt, isObject, readJson } from './helpers.ts';
import type { JsonObject, PlantedCodexSchema } from './helpers.ts';

/** Codex's hook names, as its payloads carry them, to the published schema files that describe them. */
const FILES: Record<string, string> = {
  SessionStart: 'session-start', UserPromptSubmit: 'user-prompt-submit', PreToolUse: 'pre-tool-use', PermissionRequest: 'permission-request',
  PostToolUse: 'post-tool-use', Stop: 'stop', SessionEnd: 'session-end', SubagentStart: 'subagent-start', SubagentStop: 'subagent-stop',
  PreCompact: 'pre-compact', PostCompact: 'post-compact', Interrupt: 'interrupt',
};
const SCHEMAS = join(FIXTURES, 'codex-schemas');
const provenance = readJson(join(SCHEMAS, 'provenance.json')) as { versions: Record<string, { tag: string; commit: string; files: Record<string, string> }> };
const published = (version: string, hook: string): Schema => readJson(join(SCHEMAS, version, `${FILES[hook]}.command.input.schema.json`)) as Schema;

const facts = codexFacts();
const versions = Object.keys((getAt(facts, '/events/versions') as JsonObject) ?? {});
const hooksOf = (version: string): string[] => Object.keys(getAt(facts, `/events/versions/${version}`) as JsonObject);

describe('AC6 Codex hook types are checked against Codex\'s published schemas', () => {
  it('AC6 the facts cover versions, and each has a checked-in copy of the published schemas with its tag and commit', () => {
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      expect(provenance.versions[version], `provenance for Codex ${version}`).toBeDefined();
      expect(provenance.versions[version]!.tag).toBe(`rust-v${version}`);
      expect(provenance.versions[version]!.commit).toMatch(/^[0-9a-f]{40}$/);
      for (const hook of hooksOf(version)) {
        expect(FILES[hook], `${hook} is a Codex hook with a published schema`).toBeDefined();
        const file = `${FILES[hook]}.command.input.schema.json`;
        expect(existsSync(join(SCHEMAS, version, file)), `${version}/${file} is checked in`).toBe(true);
        expect(provenance.versions[version]!.files[file], `${version}/${file} records its source URL`).toContain(`/blob/rust-v${version}/codex-rs/hooks/schema/generated/${file}`);
      }
    }
  });

  it.each(versions)('AC6 the Codex %s types drift nowhere from the published schemas', (version) => {
    for (const hook of hooksOf(version)) {
      const schema = published(version, hook);
      expect(getAt(schema, '/properties/hook_event_name/const'), `${version} ${hook}: the schema is this hook's`).toBe(hook);
      expect(factsDrift(facts, version, hook, schema), `${version} ${hook}`).toEqual([]);
    }
  });

  it.each(fixtureSet<PlantedCodexSchema>('codex-schemas/planted').map((p) => [p.name, p] as const))('AC6 planted drift: %s fails, naming the field', (name, planted) => {
    // A check that reads only the schema's title, or only the required list, passes some of these and fails here.
    const drift = factsDrift(facts, planted.version, planted.hook, planted.schema);
    expect(drift.length, `${name}: drift is found`).toBeGreaterThan(0);
    expect(drift.map((d) => d.field), `${name}: the drift names ${planted.field}`).toContain(planted.field);
    for (const d of drift) expect(d.reason.length).toBeGreaterThan(0);
  });

  it('AC6 a published schema the adapter does not know as a hook is drift too: its types cannot be checked', () => {
    // 0.160.0 publishes session-end and interrupt, which the Codex facts list no types for.
    const unlisted = readdirSync(join(SCHEMAS, '0.160.0')).filter((f) => f.endsWith('.command.input.schema.json'))
      .map((f) => f.replace('.command.input.schema.json', ''))
      .filter((file) => !hooksOf('0.160.0').some((hook) => FILES[hook] === file));
    expect(unlisted.length).toBeGreaterThan(0);
    for (const file of unlisted) {
      const schema = readJson(join(SCHEMAS, '0.160.0', `${file}.command.input.schema.json`)) as Schema;
      const hook = String(getAt(schema, '/properties/hook_event_name/const'));
      const drift = factsDrift(facts, '0.160.0', hook, schema);
      expect(drift.length, `${hook}: no types to check against`).toBeGreaterThan(0);
      expect(drift.map((d) => d.field)).toContain('hook_event_name');
    }
  });

  it('AC6 the checked-in copies are the published files: each is a draft-07 object schema titled as its hook\'s input', () => {
    for (const version of versions) {
      for (const hook of hooksOf(version)) {
        const schema = published(version, hook);
        expect(isObject(schema)).toBe(true);
        expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
        expect(schema.title).toBe(`${FILES[hook]}.command.input`);
        expect(schema.additionalProperties).toBe(false);
      }
    }
  });
});
