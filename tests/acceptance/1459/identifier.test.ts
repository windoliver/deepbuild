// AC7: on the real app, an assistive client reads `accessibilityIdentifier` equal to the snapshot's `id` on a row. The real
// `deep-app` on #1172's world (a real hub, three open asks), read from outside its process by probe.swift through the
// Accessibility API, as any assistive client reads it; the snapshot is the replica's own, deep-drive launched on a copy of
// that hub's record (`from: record_copy`). The issue allows BLOCKED when the platform can't carry the identifier: that is the
// issue's report to make, naming where it stopped; this test never passes without the identifier.
import { describe, expect, it } from 'vitest';
import { appBinary, makeWorld, useCleanup } from '../1172/helpers.ts';
import { Drive, driveBinary, ID, label, NEEDS_YOU, RealApp, rowStarting, settled, type Snapshot } from './helpers.ts';

useCleanup();
const MIN = 60_000;

describe(`AC7 ${ID.identifier} On the real app, an assistive client reads \`accessibilityIdentifier\` equal to the snapshot's \`id\` on a row. If the platform can't carry it, the issue reports BLOCKED, naming where it stopped`, () => {
  it('AC7 each Needs you row\'s accessibilityIdentifier in the real app equals that row\'s id in the replica\'s snapshot of the same record', async () => {
    const world = await makeWorld();
    const drive = await Drive.start(await driveBinary(), world.home);
    let snapshot: Snapshot;
    try {
      await drive.must({ call: 'launch', launch: { from: 'record_copy', center: NEEDS_YOU } });
      snapshot = (await drive.must({ call: 'see' })).snapshot as Snapshot;
    } finally {
      await drive.stop();
    }
    const ids = world.asks.map((ask) => ({ ask, id: rowStarting(snapshot, ask.question)?.id }));
    for (const { ask, id } of ids) expect(typeof id === 'string' && id !== '', `the replica's row for ${ask.handle} ("${ask.question}") carries an id: ${JSON.stringify(rowStarting(snapshot, ask.question))}`).toBe(true);
    const app = await RealApp.launch(world.home, await appBinary());
    try {
      const failures = await settled(async () => {
        const nodes = await app.nodes();
        return ids.flatMap(({ ask, id }) => {
          const row = nodes.find((n) => (label(n) ?? '').startsWith(ask.question));
          if (!row) return [`the real window has no row whose label starts with "${ask.question}"`];
          if (row.identifier !== id) return [`the real app's row for ${ask.handle} carries accessibilityIdentifier ${JSON.stringify(row.identifier)}, not the snapshot's id ${JSON.stringify(id)}: the id stopped before AppKit's tree (AXIdentifier on a ${String(row.role)})`];
          return [];
        });
      });
      expect(failures).toEqual([]);
    } finally {
      await app.stop();
    }
  }, 20 * MIN);
});
