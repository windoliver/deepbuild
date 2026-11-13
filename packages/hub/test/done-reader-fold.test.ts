// #1906 AC4: unknown-check refusals name the spec's checks; a missing or malformed spec names none.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { hookLine, mcp, send, session, withHub } from './hub.js';
import { ulid } from '../src/wire.js';

it('reads the same done spec through the hub for present, missing and malformed files', async () => {
  await withHub(async (root, home) => {
    const s = session(home, '0a190600-1111-4222-8333-444455556666');
    const work = s.work;
    mkdirSync(join(work,'.deepbuild'),{recursive:true});
    const file = join(work,'.deepbuild','done.yaml');
    await send(join(root,'hub.sock'),hookLine(ulid(Date.now()),'SessionStart',s.payload('SessionStart',{source:'startup'}),{ppid:process.pid}));
    const reader = mcp(home,work,false);
    try {
      await reader.request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fold-proof',version:'0'}});
      for (const contents of [undefined, 'checks: [unterminated', 'checks:\n  unit: {type: command, run: "printf done", deadline: 2m}\n']) {
        if(contents===undefined)rmSync(file,{force:true});else writeFileSync(file,contents);
        const reply=await reader.call('deep_run',{check:'nonexistent',claim:null});
        expect(reply.isError).toBe(true);
        expect(reply.value.code).toBe('enum');
        if(contents?.includes('printf done'))expect(reply.value.remediation).toContain('unit');
        else expect(reply.value.remediation).toContain('it names none');
      }
    } finally { reader.close(); }
  });
},60_000);
