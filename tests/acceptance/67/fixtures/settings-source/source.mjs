// A state source over a machine's settings file, the one the #67 suite holds to state-source@1: its `read`, `compare`
// and `undo`, and the `fixture` the kit drives (README). `settings` says which file it reads live, which fixture file
// the kit's run points it at, and where it logs the plans it carries out. `planted` makes one of the criteria's wrong
// programs: `undo-fails` calls purging the archive undoable and undoes nothing (AC5), and `first-read-kept` answers
// every read with its first answer (AC11). Plain JavaScript, so the test package and the test import the same code.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const START = { port: 80, archive: 'kept' };
/** port can be set back; a purged archive has no copy. */
const CHANGES = [
  { id: 'set-port', item: 'port', was: 80, to: 8080 },
  { id: 'purge-archive', item: 'archive', was: 'kept', to: 'purged' },
];

export function settingsSource({ file, fixture, log, planted }) {
  let target = file;
  let first;
  const load = () => JSON.parse(readFileSync(target, 'utf8'));
  const set = (item, value) => writeFileSync(target, JSON.stringify({ ...load(), [item]: value }));
  const read = () => {
    const now = Object.entries(load()).map(([id, value]) => ({ id, value }));
    if (planted !== 'first-read-kept') return now;
    first ??= now;
    return first;
  };
  return {
    read,
    compare(item, expected) {
      const same = JSON.stringify(item.value) === JSON.stringify(expected);
      return { item: item.id, changed: same ? [] : [{ what: item.id, was: expected, now: item.value }] };
    },
    undo(change) {
      if (change.id === 'purge-archive' && planted !== 'undo-fails') return { cannot: 'a purged archive has no copy' };
      return { plan: { steps: [{ does: `Set ${change.item} back to ${String(change.was)}`, changes: [change.item], undo: `Set ${change.item} to ${String(change.to)}`, public: false, cost: 0 }], diff: 'd'.repeat(64) } };
    },
    fixture: {
      start() {
        target = fixture;
        writeFileSync(target, JSON.stringify(START));
        return CHANGES;
      },
      make(change) { set(change.item, change.to); },
      run(change) {
        appendFileSync(log, `${change.id}\n`);
        if (!(planted === 'undo-fails' && change.id === 'purge-archive')) set(change.item, change.was);
      },
    },
  };
}
