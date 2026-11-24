// AC7 #3236.09a204cf: "The web player's tree for the fixture scatter equals the app's, node for node and value for
// value"
//
// One `deep-show run`: the fixture scatter shown, the app's `see`, then #172's web export of the same document
// (`video.codec: web`). The bundle is served and opened in headless Chrome with WebGPU (#172's harness, imported read
// only), and once the player is ready its page is read as #1045's suite reads it (web.ts): each element marked
// `data-deep-id` in the browser's computed accessibility tree. Node for node: #169's comparison of id, role and name, in
// the app's order, nothing missing or extra. Value for value: each app node's `value` is the page node's computed value
// or computed description, the same text (white space collapsed), and no page node has a computed value its app node
// lacks. The app's scatter node must carry a value, so the comparison can't pass on two trees with none.
// Wrong programs: a player that keeps #1045's tree without the value, or with a value of its own making.
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { done, play, useBrowsers, webReceiptOf } from '../172/helpers.ts';
import { treeFailures } from '../169/helpers.ts';
import { DOC, SCATTER, scatterDoc } from './fixtures.ts';
import { AC, Script, binOf, none, prebuild, presented, runShow, sameText, scenario, seenOf, show, useTemp, type JsonObject } from './helpers.ts';
import { pageTree } from './web.ts';

prebuild();
const temp = useTemp();
const browsers = useBrowsers();
const D = DOC(7);
const WEB_TIMEOUT = 3_600_000;

describe(`${AC[7]} the web player's tree carries the same value as the app's`, () => {
  it(`${AC[7]} the web player's tree for the fixture scatter equals the app's, node for node and value for value`, async () => {
    const out = join(temp(), 'bundle');
    const s = new Script();
    s.present(D, scatterDoc(D));
    const seen = s.see();
    const exported = s.webExport(D, out);
    const r = runShow(binOf(), scenario(temp(), [D], s.calls), 'AC7 the scatter in the app and its web export');
    presented(r[0]!, 'the fixture scatter');
    const app = seenOf(r[seen]!, 'the app\'s see').tree;
    webReceiptOf(r[exported]!, 'the scatter\'s web export');
    const f: string[] = [];
    const appNodes = app.map((n) => ({ id: String(n['id'] ?? ''), role: String(n['role'] ?? ''), name: String(n['name'] ?? ''), value: typeof n['value'] === 'string' ? n['value'] : null, raw: n as JsonObject }));
    const scatter = appNodes.find((n) => n.id === SCATTER);
    if (!scatter?.value) f.push(`the app's node ${SCATTER} carries no value to compare: ${show(scatter?.raw ?? null, 400)}`);
    const page = browsers(await play(out));
    try {
      await page.tab.mustBeReady('the scatter\'s player');
      const nodes = await pageTree(page.tab);
      f.push(...treeFailures('the player\'s accessibility tree', appNodes, nodes));
      for (const n of appNodes) {
        const p = nodes.find((x) => x.id === n.id);
        if (!p) continue;
        if (n.value !== null && !sameText(p.value, n.value) && !sameText(p.description, n.value)) {
          f.push(`node ${n.id}'s value is ${JSON.stringify(n.value)} in the app; on the page its computed value is ${JSON.stringify(p.value)} and its description ${JSON.stringify(p.description)}`);
        }
        if (n.value === null && p.value.trim() !== '') f.push(`node ${n.id} has the value ${JSON.stringify(p.value)} on the page and none in the app`);
      }
    } finally {
      await done(page);
    }
    none(f, 'the player\'s tree against the app\'s');
  }, WEB_TIMEOUT);
});
