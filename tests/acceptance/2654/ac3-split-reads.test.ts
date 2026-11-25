// #2654 criterion 3: "A line cut across two reads, and a multi-byte character cut across two reads, are each read
// whole. A planted reader that decodes each chunk alone fails, naming the request"
//
// Each request is written to deep mcp's stdin in two writes a second apart, so its reader gets them as two reads. The
// request is resources/read of a code page that doesn't exist: deep mcp's answer quotes the URI it read
// ("No resource <uri>; …", mcp.ts), so the answer shows whether the bytes were read whole. In the second test the cut
// falls inside the four bytes of U+1F600; a reader that decodes each chunk alone reads U+FFFD in its place.
import { expect, test } from 'vitest';
import { AC, Mcp, SHORT, sleep, tempHome } from './helpers.ts';

async function inTwo(text: string, cut: number): Promise<{ answer: string; shown: string }> {
  const { dir, home } = tempHome();
  const mcp = new Mcp(home, dir);
  const bytes = Buffer.from(text);
  await mcp.write(bytes.subarray(0, cut));
  await sleep(1_000);
  await mcp.write(bytes.subarray(cut));
  const answer = await mcp.waitFor((l) => l.id === 1, 60_000);
  await mcp.end();
  return { answer: String(answer?.error?.message ?? JSON.stringify(answer ?? null)), shown: mcp.shown() };
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
  const at = Buffer.from(text).indexOf(Buffer.from('\u{1F600}')) + 2;
  const { answer, shown } = await inTwo(text, at);
  expect(answer, `the request ${JSON.stringify(text)}, cut after the second of U+1F600's four bytes, is read whole: its answer quotes ${uri} (${shown})`).toContain(`No resource ${uri};`);
}, SHORT);
