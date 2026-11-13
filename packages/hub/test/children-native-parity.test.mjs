// #1906 AC4: the owner must not change the native APIs' observable results, errors, or overloads.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const owner = new URL('../dist/children.js', import.meta.url).href;
const probe = `
import cp from 'node:child_process';
if (process.env.OWNER) await import(process.env.OWNER);
const clean = value => Buffer.isBuffer(value) ? { bytes: [...value] } : Array.isArray(value) ? value.map(clean) : value;
const read = fn => { try { return { result: clean(fn()) }; } catch(e) { return { error: e.name, code: e.code, status: e.status, signal: e.signal, message: e.message.replaceAll(process.execPath,'<node>'), stdout: clean(e.stdout), stderr: clean(e.stderr) }; } };
const child = 'process.stdout.write("hi é");process.stderr.write("warning");';
const cases = [
 () => cp.execFileSync(process.execPath,['-e',child]),
 () => cp.execFileSync(process.execPath,['-e',child],{encoding:'utf8',stdio:['ignore','pipe','pipe']}),
 () => cp.execFileSync(process.execPath,['-e','process.stdout.write(process.env.PARITY)'],{env:{PARITY:'held'},encoding:'utf8'}),
 () => cp.execFileSync(process.execPath,['-e','process.stdin.pipe(process.stdout)'],{input:'bytes',encoding:'utf8'}),
 () => cp.execFileSync(process.execPath,['-e',child+'process.exit(7)'],{encoding:'utf8',stdio:'pipe'}),
 () => cp.execFileSync(process.execPath,['-e','process.kill(process.pid,"SIGTERM")'],{stdio:'pipe'}),
 () => cp.execFileSync('/no-program-1906',[],{stdio:'pipe'}),
 () => cp.execFileSync(process.execPath,['-e','setTimeout(()=>{},1000)'],{timeout:5,stdio:'pipe'}),
 () => cp.execFileSync(process.execPath,['-e','process.stdout.write("a".repeat(100))'],{maxBuffer:10,stdio:'pipe'}),
 () => cp.execFileSync('pwd',{encoding:'utf8'}),
 () => cp.execFileSync('pwd',null,{encoding:'utf8'}),
 () => cp.execFileSync('pwd',[],3),
 () => cp.execFileSync('pwd',[],{argv0:3}),
 () => cp.execFileSync('pwd',[],{argv0:'bad'+String.fromCharCode(0)}),
 () => cp.execFileSync('pwd',3),
 () => cp.execFileSync('pwd',[],{},3),
 () => cp.execSync('printf shell',{encoding:'utf8'}),
 () => cp.execSync('printf out;printf bad >&2;exit 3',{encoding:'utf8',stdio:'pipe'}),
 () => cp.execSync(3),
 () => cp.execSync('a'+String.fromCharCode(0)),
 () => cp.execSync('printf ok',{encoding:'utf8',shell:'/bin/sh'}),
 () => cp.execSync('printf ok',3),
 () => cp.execFileSync('printf',['shell'],{encoding:'utf8',shell:true,stdio:'pipe'}),
];
console.log(JSON.stringify({ meta: ['spawnSync','execFileSync','execSync'].map(k=>[k,cp[k].name,cp[k].length]), values:cases.map(read) }));
`;

test('native sync overloads, errors, encoding, stderr and function metadata remain identical', () => {
  const run = tracked => spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8', env: { ...process.env, OWNER: tracked ? owner : '' } });
  const native = run(false), tracked = run(true);
  assert.equal(native.status, 0, native.stderr);
  assert.equal(tracked.status, 0, tracked.stderr);
  const scrub = text => text.replaceAll(/\(node:\d+\)/g, '(node:<pid>)').replaceAll(/\s+at .*\n/g, '');
  assert.deepEqual(JSON.parse(tracked.stdout), JSON.parse(native.stdout));
  assert.equal(scrub(tracked.stderr), scrub(native.stderr));
});
