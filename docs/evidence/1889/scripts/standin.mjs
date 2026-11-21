// A stand-in Gmail for the #1889 e2e: a local HTTP server answering the Gmail v1 paths the shipped Gmail source
// uses. No network beyond 127.0.0.1; nothing is forwarded anywhere. Every request is logged.
//
// Behaviour by CASE (argv[2]):
//   read-503      the first send is kept, its answer lost (socket dropped); message reads answer 503 three times, then 200
//   read-timeout  the first send is kept, its answer lost; message reads hang (never answered) twice, then 200
//   marker-missing the first send is dropped before it is kept (never landed), its answer lost; reads answer 200
//   marker-present the first send is kept, its answer lost; reads answer 200
//   read-404      the first send is dropped before it is kept, its answer lost; find's first message read answers 404, later 200
// The port is printed as `PORT <n>`; `POST /_add` puts the client's email in Label_7; `GET /_count` answers the sends.
import { createServer } from 'node:http';

const CASE = process.argv[2];
const CASES = ['read-503', 'read-timeout', 'marker-missing', 'marker-present', 'read-404'];
if (!CASES.includes(CASE)) { console.error(`case must be one of ${CASES.join(', ')}`); process.exit(2); }

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const messages = new Map();
const email = () => ({
  id: 'm1889', threadId: 't-1889', labelIds: ['INBOX', 'Label_7'], at: Date.now(), from: 'Ana Client <ana@client.example.test>',
  subject: 'The export drops rows', text: 'Please fix the nightly export.', headers: {},
});
let ids = 9000;
let sendsSeen = 0;
let reads = 0;
const kept = () => [...messages.values()].filter((m) => m.labelIds.includes('SENT'));
const full = (m) => ({
  id: m.id, threadId: m.threadId, labelIds: m.labelIds, internalDate: String(m.at),
  payload: {
    mimeType: 'text/plain',
    headers: [{ name: 'From', value: m.from }, { name: 'Subject', value: m.subject }, { name: 'Message-ID', value: `<${m.id}@mail.example.test>` },
      ...Object.entries(m.headers).map(([name, value]) => ({ name, value }))],
    body: { size: m.text.length, data: b64url(m.text) },
  },
});
const log = (s) => console.log(`[stand-in ${CASE}] ${s}`);

const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname.replace(/^\/gmail\/v1\/users\/me/, '');
    const answer = (status, body) => { log(`${req.method} ${url.pathname}${url.search} -> ${status}`); res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body)); };
    if (url.pathname === '/_add') { messages.set('m1889', email()); log('client email m1889 arrives in Label_7'); return res.end('{}'); }
    if (url.pathname === '/_count') return res.end(JSON.stringify({ sends_received: sendsSeen, sends_kept: kept().length }));
    if (!req.headers.authorization) return answer(401, { error: { code: 401 } });
    if (req.method === 'GET' && p === '/profile') return answer(200, { emailAddress: 'you@example.test' });
    if (req.method === 'GET' && p === '/messages') {
      const all = [...messages.values()].filter((m) => m.labelIds.includes(url.searchParams.get('labelIds') ?? ''));
      return answer(200, { messages: all.map((m) => ({ id: m.id, threadId: m.threadId })), resultSizeEstimate: all.length });
    }
    const one = /^\/messages\/([\w-]+)$/.exec(p);
    if (req.method === 'GET' && one) {
      // Only reads after the first send count: the run that takes the email in reads it too.
      if (sendsSeen > 0) {
        reads++;
        if (CASE === 'read-503' && reads <= 3) return answer(503, { error: { code: 503, message: 'The service is currently unavailable.' } });
        if (CASE === 'read-timeout' && reads <= 2) { log(`${req.method} ${url.pathname} -> (no answer: held open)`); return; }
        if (CASE === 'read-404' && reads === 1) return answer(404, { error: { code: 404, message: 'Requested entity was not found.' } });
      }
      const m = messages.get(one[1]);
      return m ? answer(200, full(m)) : answer(404, { error: { code: 404, message: 'Requested entity was not found.' } });
    }
    const thread = /^\/threads\/([\w-]+)$/.exec(p);
    if (req.method === 'GET' && thread) {
      const ms = [...messages.values()].filter((m) => m.threadId === thread[1]).sort((a, b) => a.at - b.at);
      return ms.length ? answer(200, { id: thread[1], messages: ms.map(full) }) : answer(404, { error: { code: 404 } });
    }
    if (req.method === 'POST' && p === '/messages/send') {
      sendsSeen++;
      const b = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const raw = unb64(String(b.raw ?? '')).replace(/\r\n/g, '\n');
      const headers = {};
      for (const line of raw.split('\n\n')[0].split('\n')) { const m = /^([\w-]+):\s*(.*)$/.exec(line); if (m) headers[m[1]] = m[2]; }
      const first = sendsSeen === 1;
      const lands = !(first && (CASE === 'marker-missing' || CASE === 'read-404'));
      if (lands) {
        const id = `s${++ids}`;
        messages.set(id, { id, threadId: b.threadId, labelIds: ['SENT'], at: Date.now(), from: 'you@example.test', subject: headers.Subject ?? '', text: raw.split('\n\n').slice(1).join('\n\n'), headers });
      }
      log(`POST /messages/send #${sendsSeen} marker ${headers['X-DeepBuild-Send']} ${lands ? 'KEPT' : 'NOT kept'}${first ? ', answer lost (socket dropped)' : ' -> 200'}`);
      if (first) return req.socket.destroy();
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: `s${ids}`, threadId: b.threadId }));
    }
    return answer(404, { error: { code: 404 } });
  });
});
server.listen(0, '127.0.0.1', () => console.log(`PORT ${server.address().port}`));
process.on('SIGTERM', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
