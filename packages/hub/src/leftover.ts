/** What a down left: a process on a leased port, a port nothing could check, or a process the cleanup couldn't prove. */
type Left = { pid: number; port: number } | { port: number; cause: string } | { pid: number };
/** A lease in the lease table, as far as a down reads it. */
export interface Held { id: string; resource: { host: string; kind: string; key: string } }

/**
 * Takes a stack down with `down` and reports what it left (#331). Every process the cleanup couldn't prove (its `left`,
 * `pid:<n>`) is reported, and every listener on the stack's ports after the down, once for each port. A port another
 * lease holds by then was released and leased again, as by another worktree's up, which leases a port before
 * anything listens there: its listeners are that lease's, never this stack's leftovers. A port lsof can't list is
 * reported with the cause, since nothing proves it free; a lease table that can't be read, before the down or after,
 * proves no port leased again. The down's own result is kept either way.
 */
export async function downLeaving<T extends { left: string[] }>(
  ports: number[],
  read: { listen: (port: number) => Promise<number[]>; leases: () => Promise<Held[]> },
  down: () => Promise<T>,
): Promise<{ result: T; left: Left[] }> {
  const portLeases = async () => (await read.leases()).filter((l) => l.resource.host === 'local' && l.resource.kind === 'port' && ports.includes(Number(l.resource.key)));
  // The leases on the stack's ports before its down, which the stack still holds then; unread, no later lease is
  // proven another's.
  const own = await portLeases().then((ls) => new Set(ls.map((l) => l.id)), () => undefined);
  const result = await down();
  const left: Left[] = [];
  for (const port of ports) {
    const pids = await read.listen(port).catch((error: Error) => error);
    // Read after the listeners, so a lease taken while lsof ran still counts.
    const again = own && await portLeases().then((ls) => ls.some((l) => l.resource.key === String(port) && !own.has(l.id)), () => false);
    if (again) continue;
    if (pids instanceof Error) left.push({ port, cause: pids.message });
    else for (const pid of pids) left.push({ pid, port });
  }
  for (const name of result.left) {
    const pid = Number(name.slice(4));
    if (name.startsWith('pid:') && !left.some((l) => 'pid' in l && l.pid === pid)) left.push({ pid });
  }
  return { result, left };
}
