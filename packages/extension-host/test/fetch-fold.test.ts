// #1906 AC4: generic deep.fetch does not follow redirects or turn CONNECT into the Source reachability probe.
import { createServer } from 'node:http';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openRecord } from '@deepbuild/record';
import { openSupervisor } from '@deepbuild/supervisor';
import { openExtensionHost, openTrust, packageDigest } from '../src/index.js';
import { cleanup, closing, pkgOf, temp } from './package.js';

afterAll(cleanup);
it('keeps redirect responses and rejects CONNECT without an HTTP request', async () => {
  const paths: string[] = [];
  let connections = 0;
  const server = createServer((request, response) => { paths.push(request.url!); response.writeHead(302, { location: '/next' }); response.end('redirected'); });
  server.on('connection', () => connections++);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `127.0.0.1:${(server.address() as { port:number }).port}`;
  const root = temp();
  const record = await openRecord({ path: join(root,'db'), now:Date.now });
  const asks = await openAsks({ record, now:Date.now, deliver:()=>{} });
  const supervisor = await openSupervisor({ record, asks, now:Date.now, settings:{asks:{unblock:{deadline_ms:60_000}}} });
  const code = `export default function(deep){deep.registerAction('ext.fetchfold.go',{declares:'read',input:{type:'object',properties:{method:{type:'string'}},required:['method'],additionalProperties:false}},async input=>{try{const r=await deep.fetch({url:'http://${address}/redirect',method:input.method});return {status:r.status,body:r.body};}catch{return {failed:true};}});}`;
  const pkg = pkgOf('test/fetchfold',code,{actions:['ext.fetchfold.go'],access:{words:['hosts']}});
  const host = await openExtensionHost({ record,asks,supervisor,trust:await openTrust({record,now:Date.now}),home:join(root,'home'),now:Date.now,release:[{id:'test/fetchfold',version:'1.0.0',digest:packageDigest(pkg)}] });
  closing.push(record,supervisor,host);
  try {
    await host.ready();
    const installed=await host.install({from:pkg,builtBy:null,grant:{record:[],hosts:[{host:address,quota:{calls:5,per_ms:60_000}}]}});
    expect((await host.check(installed)).passed).toBe(true);
    expect((await host.load(installed)).status).toBe('loaded');
    const call=(method:string)=>host.callAction({action:'ext.fetchfold.go',target:{handle:'ext:test/fetchfold',version:'1.0.0'},input:{method},caller:{writer:'app',actor:'you',scope:'you'}});
    expect(await call('GET')).toEqual({status:'done',output:{status:302,body:'redirected'}});
    expect(paths).toEqual(['/redirect']);
    const before=connections;
    expect(await call('CONNECT')).toEqual({status:'done',output:{failed:true}});
    expect(paths).toEqual(['/redirect']);
    expect(connections).toBe(before);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
