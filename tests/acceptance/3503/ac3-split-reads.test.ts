// #3503 criterion 3: "A line cut across two reads, and a multi-byte character cut across two reads, are each read whole.
// A planted reader that decodes each chunk alone fails, naming the request"
//
// One write holds a whole ping (id 0) and the first part of a resources/read request; the rest of the request goes only
// once the ping is answered. By then the server has read past the ping, and the rest wasn't in its pipe yet, so the
// request reaches it in at least two reads, with no fixed wait. The request asks for a code page that doesn't exist, and
// the server's answer quotes the URI it read ("No resource <uri>; …", actions.rs), so the answer shows whether the bytes
// were read whole. In the second test the cut falls after the second of U+1F600's four bytes; a reader that decodes each
// chunk alone reads U+FFFD there.
import { expect, test } from 'vitest';
import { AC, SHORT, request, startActions, tempHome } from './helpers.ts';

async function inTwo(text: string, cut: number): Promise<{ answer: string; shown: string }> {
  const { dir, home } = tempHome();
  const server = startActions(home, dir);
  const bytes = Buffer.from(text);
  await server.write(Buffer.concat([Buffer.from(request(0, 'ping')), bytes.subarray(0, cut)]));
  const pinged = await server.waitFor((l) => l.id === 0, 60_000);
  if (!pinged) throw Error(`BLOCKED: the ping before the cut request got no answer: ${server.shown()}`);
  await server.write(bytes.subarray(cut));
  const answer = await server.waitFor((l) => l.id === 1, 60_000);
  await server.end();
  return { answer: String(answer?.error?.message ?? JSON.stringify(answer ?? null)), shown: server.shown() };
}

test(`${AC.split} a request line cut across two reads is read whole and answered`, async () => {
  const uri = 'deep://codes/no_such_page';
  const text = `{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"${uri}"}}\n`;
  const { answer, shown } = await inTwo(text, text.indexOf('resources/') + 'resources/'.length);
  expect(answer, `the request ${JSON.stringify(text)}, cut after "resources/", is read whole: its answer quotes ${uri} (${shown})`).toContain(`No resource ${uri};`);
}, SHORT);

test(`${AC.split} a multi-byte character cut across two reads is read whole`, async () => {
  const uri = 'deep://codes/café-\u{1F600}';
  const text = `{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"${uri}"}}\n`;
  const { answer, shown } = await inTwo(text, Buffer.from(text).indexOf(Buffer.from('\u{1F600}')) + 2);
  expect(answer, `the request ${JSON.stringify(text)}, cut after the second of U+1F600's four bytes, is read whole: its answer quotes ${uri} (${shown})`).toContain(`No resource ${uri};`);
}, SHORT);
