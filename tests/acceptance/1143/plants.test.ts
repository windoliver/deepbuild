// #1143's two planted failures, each in a throwaway copy of this checkout (helpers.ts, copyCheckout), never in the
// checkout itself: a home path in a BASE-FAILURE.txt that repo-rules must fail, naming the file and line, and event
// schemas planted beside the published ones, which events.test.ts must fail, naming the schema, when the envelope
// differs in anything but the schema's history, and must pass when it differs only in its history.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { AC, copyCheckout, eventsTest, repoRules, tail } from './helpers.ts';

const MINUTE = 60_000;
let copy = '';
beforeAll(() => {
  copy = copyCheckout();
}, 15 * MINUTE);
afterAll(() => {
  if (copy) rmSync(copy, { recursive: true, force: true });
});

describe('AC1 the planted home path', () => {
  test(`AC1 ${AC[1]} a planted macOS home path in a BASE-FAILURE.txt fails repo-rules, naming the file and line`, () => {
    const folder = join(copy, 'tests/acceptance/1143-plant');
    const file = 'tests/acceptance/1143-plant/BASE-FAILURE.txt';
    // Built from parts so this source file holds no home path itself.
    const home = ['', 'Users', 'sam', ''].join('/');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(copy, file), [
      '#1143-plant: a run at the base, as a base-failure record keeps it',
      ` FAIL  packages/contracts/test/events.test.ts at ${home}deepbuild/packages/contracts/test/events.test.ts:307:60`,
      ' Test Files  1 failed (1)',
      '',
    ].join('\n'));
    try {
      const { status, lines, output } = repoRules(copy);
      const named = lines.filter((line) => line.startsWith(`FAIL secrets: ${file}:2:`));
      expect(named, `repo-rules prints no FAIL secrets line naming ${file} and line 2:\n${tail(output)}`).toHaveLength(1);
      expect(named[0]).toMatch(/home path/);
      expect(status, 'repo-rules exits non-zero on the planted home path').not.toBe(0);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }, 5 * MINUTE);
});

describe('AC2 the planted event schemas', () => {
  type Schema = Record<string, unknown> & { properties: Record<string, Record<string, unknown>> };
  const schemas = () => join(copy, 'packages/contracts/schemas');
  /** note.closed@1, an R1 event kind with the shared envelope, copied as a new kind `<kind>@1` and changed by `change`. */
  const plant = (kind: string, change: (schema: Schema) => void): (() => void) => {
    const schema = JSON.parse(readFileSync(join(schemas(), 'note.closed@1.json'), 'utf8')) as Schema;
    schema.title = `${kind}@1`;
    schema.description = `A planted event kind for #1143's acceptance tests.`;
    schema.properties.kind = { const: kind };
    change(schema);
    const path = join(schemas(), `${kind}@1.json`);
    writeFileSync(path, `${JSON.stringify(schema, null, 2)}\n`);
    return () => rmSync(path, { force: true });
  };
  const failsNaming = (name: string) => {
    const { status, assertions, output } = eventsTest(copy);
    const naming = assertions.filter((a) => a.status === 'failed' && a.failureMessages.some((m) => m.includes(name)));
    const failed = assertions.filter((a) => a.status === 'failed').map((a) => `${a.fullName}: ${a.failureMessages.join(' ').split('\n')[0]}`);
    expect(naming.map((a) => a.fullName), `no failing test in events.test.ts names ${name}; the failures were: ${JSON.stringify(failed)}\n${tail(output)}`).not.toEqual([]);
    expect(status).not.toBe(0);
  };
  const passes = (name: string) => {
    const { status, assertions, output } = eventsTest(copy);
    const failed = assertions.filter((a) => a.status !== 'passed').map((a) => `${a.fullName}: ${a.failureMessages.join(' ').split('\n')[0]}`);
    expect(failed, `with ${name} planted, which differs from the others only in its history, events.test.ts fails`).toEqual([]);
    expect(assertions.length).toBeGreaterThan(0);
    expect(status, tail(output)).toBe(0);
  };

  test(`AC2 ${AC[2]} a planted event schema with an extra envelope field fails events.test.ts, naming the schema`, () => {
    const remove = plant('plant.envelope', (schema) => {
      schema.properties.via = { type: 'string', maxLength: 8192, description: 'A field no other envelope has.' };
    });
    try {
      failsNaming('plant.envelope@1');
    } finally {
      remove();
    }
  }, 5 * MINUTE);

  test(`AC2 ${AC[2]} a planted event schema whose envelope allows other fields fails events.test.ts, naming the schema`, () => {
    const remove = plant('plant.open', (schema) => {
      schema.additionalProperties = true;
    });
    try {
      failsNaming('plant.open@1');
    } finally {
      remove();
    }
  }, 5 * MINUTE);

  test(`AC2 ${AC[2]} (scope) a planted event schema that differs only in x-since, as the R2 kinds do, passes events.test.ts`, () => {
    const remove = plant('plant.since', (schema) => {
      schema['x-since'] = 'R2';
    });
    try {
      passes('plant.since@1');
    } finally {
      remove();
    }
  }, 5 * MINUTE);

  test(`AC2 ${AC[2]} (scope) a planted event schema that differs in all five history fields passes events.test.ts`, () => {
    const remove = plant('plant.history', (schema) => {
      Object.assign(schema, { 'x-since': 'R3', 'x-stability': 'preview', 'x-tracking': '#1143', 'x-deprecated_since': 'R3', 'x-replaced_by': 'note.closed@1' });
    });
    try {
      passes('plant.history@1');
    } finally {
      remove();
    }
  }, 5 * MINUTE);
});
