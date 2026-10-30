// What deep env down reports as left on a stack's leased ports (#331 AC10). lsof and the lease table are faked: lsof
// is a boundary the hub doesn't own, and the windows these tests hold open (a port leased again mid-down, an lsof or
// a lease table that fails) can't be timed on real ones.
import { expect, it } from 'vitest';
import { downLeaving, type Held } from '../src/leftover.js';

const lease = (id: string, key: number, kind = 'port', host = 'local'): Held => ({ id, resource: { host, kind, key: String(key) } });

/**
 * A stack whose down leaves `left` to its cleanup; after the down, lsof answers `listeners` and the lease table
 * `after` (`before` until then, or Error to fail). `onListen` runs as lsof lists a port.
 */
function stack(o: { listeners: Record<number, number[] | Error>; before: Held[] | Error; after: Held[] | Error; left?: string[]; onListen?: (port: number) => void }) {
  let down = false;
  return {
    read: {
      listen: async (port: number) => {
        if (!down) throw Error('lsof was read before the down');
        o.onListen?.(port);
        const got = o.listeners[port] ?? [];
        if (got instanceof Error) throw got;
        return got;
      },
      leases: async () => {
        const got = down ? o.after : o.before;
        if (got instanceof Error) throw got;
        return got;
      },
    },
    down: async () => { down = true; return { stopped: [11], left: o.left ?? [] }; },
  };
}

it("a listener on a port leased again during the down is that lease's; every listener on a port still unleased or still the stack's is left", async () => {
  // 3000 was released and leased again (L9) by another worktree's up, whose server 31 listens there; on Docker Desktop
  // one daemon PID listens for every compose project. On 3001, 21 started during the down, as a watcher respawning the
  // server would; leases of another kind or host on its key aren't port leases on this machine. On 3002 the stack's
  // own lease L3 is still held, since a process it recorded is left there.
  const s = stack({
    listeners: { 3000: [31], 3001: [21], 3002: [22] },
    before: [lease('L1', 3000), lease('L2', 3001), lease('L3', 3002)],
    after: [lease('L9', 3000), lease('L3', 3002), lease('C1', 3001, 'compose'), lease('R1', 3001, 'port', 'remote')],
  });
  const { result, left } = await downLeaving([3000, 3001, 3002], s.read, s.down);
  expect(result).toEqual({ stopped: [11], left: [] });
  expect(left).toEqual([{ pid: 21, port: 3001 }, { pid: 22, port: 3002 }]);
});

it('a lease taken while lsof lists the port still counts: the leases are read after the listeners', async () => {
  const after: Held[] = [];
  const s = stack({ listeners: { 3000: [31] }, before: [lease('L1', 3000)], after, onListen: (port) => after.push(lease('L9', port)) });
  const { left } = await downLeaving([3000], s.read, s.down);
  expect(left).toEqual([]);
});

it("an lsof that fails after the down keeps the down's result and reports the port it couldn't check, unless the port is leased again", async () => {
  const s = stack({
    listeners: { 3000: [], 3001: Error("lsof can't list port 3001's listeners: denied"), 3002: Error('lsof timed out') },
    before: [lease('L1', 3000), lease('L2', 3001), lease('L3', 3002)],
    after: [lease('L9', 3002)],
  });
  const { result, left } = await downLeaving([3000, 3001, 3002], s.read, s.down);
  expect(result).toEqual({ stopped: [11], left: [] });
  expect(left).toEqual([{ port: 3001, cause: "lsof can't list port 3001's listeners: denied" }]);
});

it("a lease table that fails after the down keeps the down's result and proves no port leased again", async () => {
  const s = stack({ listeners: { 3000: [21] }, before: [lease('L1', 3000)], after: Error('the record is closed') });
  const { result, left } = await downLeaving([3000], s.read, s.down);
  expect(result).toEqual({ stopped: [11], left: [] });
  expect(left).toEqual([{ pid: 21, port: 3000 }]);
});

it("a lease table that fails before the down proves no lease after it another's, so the stack's own still-held one hides nothing", async () => {
  const s = stack({ listeners: { 3000: [21] }, before: Error('the record is busy'), after: [lease('L1', 3000)] });
  const { left } = await downLeaving([3000], s.read, s.down);
  expect(left).toEqual([{ pid: 21, port: 3000 }]);
});

it("one process on two of the stack's ports is left on each; one the cleanup couldn't prove is named once, with its port when it listens", async () => {
  const held = [lease('L1', 3000), lease('L2', 3001)];
  const s = stack({ listeners: { 3000: [21], 3001: [21] }, before: held, after: held, left: ['pid:21', 'pid:40', 'pgid:40'] });
  const { left } = await downLeaving([3000, 3001], s.read, s.down);
  expect(left).toEqual([{ pid: 21, port: 3000 }, { pid: 21, port: 3001 }, { pid: 40 }]);
});
