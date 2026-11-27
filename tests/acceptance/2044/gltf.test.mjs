// #2044 criteria 3, 4 and 5: a glTF accessor whose rows don't fit its buffer view is refused, naming the accessor; a
// node listed as a child twice is refused, naming the node; and a file that only looks like either (two accessors
// interleaved in one buffer view, two nodes that use one mesh) still imports as it did.
// Run: node --test --test-concurrency=1 tests/acceptance/2044/gltf.test.mjs   (README.md beside this file)
//
// Each fixture is a glTF JSON with its buffer inline (make-fixtures.mjs). The reader imports its first scene
// (`deep_canvas_scene3d::gltf::import`) in a process of its own, under a deadline and a heap cap, and prints the
// fault the import refused it with, or what it imported; the test reads that.
import { after, test } from 'node:test';
import { answer, fixture, holds, importOf, importsAs, refusedNaming, run, TEST_MS, tidy } from './helpers.mjs';

// Each criterion's tag: `#2044.<first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed>`.
const AC3 = 'AC3 #2044.5bc09669';
const AC4 = 'AC4 #2044.e7ef5233';
const AC5 = 'AC5 #2044.57d379a6';

after(tidy);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test(`${AC3} a glTF under 1 KiB with one accessor of count 1,000,000 over a 12-byte buffer view with byteStride 0 is refused, naming the accessor`, { timeout: TEST_MS }, () => {
  const { file, shown, bytes } = fixture('accessor.gltf');
  const doc = JSON.parse(bytes.toString('utf8'));
  const view = doc.bufferViews[doc.accessors[0].bufferView];
  holds(bytes.length < 1024, `${shown} is ${bytes.length} bytes, not under 1 KiB`);
  holds(doc.accessors.length === 1 && doc.accessors[0].count === 1_000_000, `${shown} has ${doc.accessors.length} accessors, the first of count ${doc.accessors[0].count}, not one of count 1,000,000`);
  holds(view.byteLength === 12 && view.byteStride === 0, `${shown}'s accessor is over a buffer view of ${view.byteLength} bytes with byteStride ${view.byteStride}, not 12 bytes with byteStride 0`);
  const got = answer(run(['gltf', file]), `the import of ${shown}`);
  refusedNaming(got, { word: 'accessor', index: 0, who: shown, states: 'its one accessor, accessor 0, states 1,000,000 rows over a 12-byte buffer view with byteStride 0' });
});

test(`${AC4} a glTF of 24 nodes, each listing the next node twice as its children, is refused, naming node 1 as reached twice`, { timeout: TEST_MS }, () => {
  const { file, shown, bytes } = fixture('nodes.gltf');
  const { nodes } = JSON.parse(bytes.toString('utf8'));
  holds(nodes.length === 24, `${shown} has ${nodes.length} nodes, not 24`);
  holds(nodes.every((node, i) => (i < 23 ? same(node.children, [i + 1, i + 1]) : node.children === undefined)), `not every node of ${shown} but the last lists the next node twice as its children`);
  const got = answer(run(['gltf', file]), `the import of ${shown}`);
  refusedNaming(got, { word: 'node', index: 1, who: shown, states: 'node 0 lists node 1 twice, so node 1 is the first node reached twice (a walk with no memory of where it has been visits 16,777,215 nodes)' });
});

test(`${AC5} a glTF with two accessors interleaved in one buffer view at byteStride 24, and two nodes that use one mesh, imports to the same result as on the merge base`, { timeout: TEST_MS }, () => {
  const { file, shown, bytes } = fixture('shared-mesh.gltf');
  const doc = JSON.parse(bytes.toString('utf8'));
  holds(doc.bufferViews.length === 1 && doc.bufferViews[0].byteStride === 24, `${shown} has ${doc.bufferViews.length} buffer views, the first with byteStride ${doc.bufferViews[0].byteStride}, not one with byteStride 24`);
  holds(same(doc.accessors.map((accessor) => [accessor.bufferView, accessor.byteOffset]), [[0, 0], [0, 12]]), `${shown}'s accessors are not two in buffer view 0, the second 12 bytes into each row of the first`);
  holds(doc.meshes.length === 1 && same(doc.nodes.map((node) => node.mesh), [0, 0]), `${shown} is not two nodes that both use the file's one mesh`);
  const got = answer(run(['gltf', file]), `the import of ${shown}`);
  importsAs(got, importOf(bytes), `${shown}, whose two accessors are interleaved at byteStride 24 and whose nodes 0 and 1 both use mesh 0,`);
});
