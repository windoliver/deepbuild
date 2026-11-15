import { describe, expect, it } from 'vitest';
import { cargoMetadata, normalClosure } from './helpers.ts';

describe('Scope: auto layout on the canvas by Taffy, with text leaves measured by the shaper', () => {
  it('Scope: the canvas module crate that builds deep-layout lays out with Taffy and measures text with the canvas\'s one shaper (deep-text)', () => {
    const meta = cargoMetadata();
    const owners = meta.packages.filter((p) => meta.workspace_members.includes(p.id) && p.targets.some((t) => t.name === 'deep-layout' && t.kind.includes('bin')));
    expect(owners.map((p) => p.name), 'one workspace package builds the deep-layout binary').toHaveLength(1);
    const owner = owners[0]!;
    // marks2d owns frames and their auto layout (the module table); a canvas module crate is named
    // deep-canvas…, which puts it in scripts/canvas-lint.mjs's scope, as checks read its boxes.
    expect(owner.name.startsWith('deep-canvas'), `${owner.name} is a canvas module crate (deep-canvas…)`).toBe(true);
    const closure = normalClosure(meta, owner.id);
    // Computed by Taffy (Auto layout: Semantics), not a layout of its own.
    expect(closure.has('taffy'), `${owner.name} depends on taffy (normal dependencies)`).toBe(true);
    // Text leaves measured by the canvas's one shaper, not a second text engine.
    expect(closure.has('deep-text'), `${owner.name} depends on deep-text (normal dependencies)`).toBe(true);
  }, 120_000);
});
