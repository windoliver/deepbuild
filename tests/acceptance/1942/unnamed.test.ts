// AC1 #1942.4fd41df2: a host that isn't in your SSH config is never contacted.
//
// The world's ~/.ssh/config names one host, dh-ubuntu (a real VM, through the relay), and ends with a `Host *` block
// whose HostName and Port lead to a listener that counts every connection made to it: an ssh run for any name the
// config doesn't name would land there. Read (README): the hub lists dh-ubuntu and no other name, and reads its facts
// over SSH (the system fact holds the VM's kernel release, and the relay saw the connection); then for each name the
// config doesn't name (an alias, an address, an ssh:// URL reaching the listener's port) host.facts and run.start are
// refused, naming it, and the listener counts no connection, then or in the 5 s after.
import { describe, expect, test } from 'vitest';
import { AC, COMMIT, control, must, openWorld, proof, redact, sleep, someClaim, unknownMethod } from './helpers.ts';

describe(AC[1], () => {
  test('the hub lists and reads only the host your SSH config names; a name it doesn\'t name, in any form, is refused and never contacted', async () => {
    const w = await openWorld('deep-ubuntu', { catchAll: true });
    const counter = w.stranger!;
    const listed = await must(w, 'host.list', {});
    const names = ((listed.hosts ?? []) as { name?: unknown }[]).map((h) => String(h.name));
    expect(names, `host.list names the host your SSH config names, ${w.alias}: ${JSON.stringify(listed).slice(0, 600)}`).toContain(w.alias);
    expect(names.filter((n) => n !== w.alias), 'host.list names no other host: the config names no other, and `Host *` is a pattern, not a host').toEqual([]);

    const kernel = (await w.host.must('uname -r')).trim();
    const facts = await must(w, 'host.facts', { host: w.alias, refresh: true }, 120_000);
    expect(JSON.stringify(facts.facts?.system?.value ?? null), `${w.alias}'s system fact, read over SSH, holds its kernel release ${kernel}: ${redact(JSON.stringify(facts).slice(0, 800), w.host.ssh)}`).toContain(kernel);
    expect(w.relay.conns.length, `${w.alias} was reached at the Port its block in your SSH config names (the relay)`).toBeGreaterThan(0);

    const strangers = ['dh1942-stranger', '127.0.0.1', `ssh://dh@127.0.0.1:${counter.port}`];
    const problems: string[] = [];
    for (const name of strangers) {
      const before = counter.conns.length;
      const f = await control(w, 'host.facts', { host: name, refresh: true }, 60_000);
      if (!f.error) problems.push(`host.facts for ${name}, which your SSH config doesn't name, answered ${redact(JSON.stringify(f.result).slice(0, 300), w.host.ssh)}`);
      else if (unknownMethod(f)) problems.push(`the hub serves no host.facts: ${JSON.stringify(f.error).slice(0, 300)}`);
      else if (!JSON.stringify(f.error).includes(name)) problems.push(`host.facts for ${name} was refused without naming it: ${JSON.stringify(f.error).slice(0, 300)}`);
      const r = await control(w, 'run.start', { check: 'unnamed', claim: someClaim(), commit: COMMIT, argv: ['/bin/sh', '-c', 'echo contacted'], cwd: '/tmp', host: name }, 60_000);
      if (!r.error) problems.push(`run.start on ${name}, which your SSH config doesn't name, was taken: ${JSON.stringify(r.result).slice(0, 300)}`);
      else if (!JSON.stringify(r.error).includes(name)) problems.push(`run.start on ${name} was refused without naming it: ${JSON.stringify(r.error).slice(0, 300)}`);
      if (counter.conns.length > before) problems.push(`host.facts and run.start naming ${name} made ${counter.conns.length - before} connection(s) to the listener your config's \`Host *\` leads to: a host it doesn't name was contacted`);
    }
    await sleep(5000);
    const late = counter.conns.length;
    proof(w, 'ac1-unnamed.json', { listed, strangers, problems, stranger_connections: late, named_connections: w.relay.conns.length });
    expect(problems.map((p) => redact(p, w.host.ssh)), 'every name your SSH config doesn\'t name is refused, naming it, and never contacted').toEqual([]);
    expect(late, 'in the 5 s after, nothing contacted a host your SSH config doesn\'t name').toBe(0);
  }, 600_000);
});
