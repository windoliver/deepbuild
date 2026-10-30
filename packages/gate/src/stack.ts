// The tree a stack served (#29; design: The stack a check runs against). The core, never the environment, works out
// from the supervisor's records which tree the stack served over the run: each host process's working folder and the
// files it read, each container's bind mounts, and the build its image came from. A run whose stack served another
// tree, or one the records can't place, is uncounted, naming the process, mount or image and its tree.
export interface StackRecords {
  processes: { name: string; pid: number; cwd: string; reads: string[] }[];
  containers: { name: string; binds: string[]; image: { name: string; built_from: { context: string; digest: string } | null } }[];
}
export interface Trees { checkout: string; digests: Record<string, string>; worktree: string; others: string[] }
export type Served =
  | { served: 'checkout' }
  | { served: 'other'; tree: string; named: string; kind: 'process' | 'mount' | 'image' }
  | { served: 'unknown'; named: string; kind: 'process' | 'mount' | 'image' };

const under = (path: string, tree: string): boolean => path === tree || path.startsWith(`${tree.replace(/\/+$/, '')}/`);

export function attributeStack(records: StackRecords, trees: Trees, options: { plant?: 'takes-environments-word' } = {}): Served {
  // The planted wrong program: the environment said it started from the checkout, and that is taken as so.
  if (options.plant === 'takes-environments-word') return { served: 'checkout' };
  const elsewhere = [trees.worktree, ...trees.others];
  const place = (path: string): 'checkout' | string | null => (under(path, trees.checkout) ? 'checkout' : elsewhere.find((t) => under(path, t)) ?? null);
  for (const p of records.processes) {
    for (const path of [p.cwd, ...p.reads]) {
      const at = place(path);
      if (at === null) return { served: 'unknown', kind: 'process', named: `process ${p.name} (pid ${p.pid}) at ${path}, in no tree the core knows` };
      if (at !== 'checkout') return { served: 'other', kind: 'process', tree: at, named: `process ${p.name} (pid ${p.pid}) working in ${p.cwd}${path === p.cwd ? '' : `, reading ${path}`}, of ${at}` };
    }
  }
  for (const c of records.containers) {
    for (const bind of c.binds) {
      const at = place(bind);
      if (at === null) return { served: 'unknown', kind: 'mount', named: `mount ${bind} of container ${c.name}, in no tree the core knows` };
      if (at !== 'checkout') return { served: 'other', kind: 'mount', tree: at, named: `mount ${bind} of container ${c.name}, of ${at}` };
    }
    const from = c.image.built_from;
    if (!from) return { served: 'unknown', kind: 'image', named: `image ${c.image.name} of container ${c.name}, whose build the records can't place` };
    const at = place(from.context);
    if (at === null) return { served: 'unknown', kind: 'image', named: `image ${c.image.name} built from ${from.context}, in no tree the core knows` };
    if (at !== 'checkout') return { served: 'other', kind: 'image', tree: at, named: `image ${c.image.name} built from ${from.context}, of ${at}` };
    const want = trees.digests[from.context];
    if (want !== undefined && want !== from.digest) {
      return { served: 'other', kind: 'image', tree: trees.checkout, named: `image ${c.image.name} built from ${from.context} at ${from.digest}, not the checkout's ${want}` };
    }
  }
  return { served: 'checkout' };
}
