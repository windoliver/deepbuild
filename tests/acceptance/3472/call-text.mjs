// What a taste call made on the design as it is now names: each sentence and table cell States people see gained
// since the base, and each sentence of the plain-words line under Later, as extensions that holds `plain`. It prints
// them to read, then the `text` value docs/evidence/3472/taste-call.json holds for them (README.md, The taste call).
// It judges nothing and writes no file: the call is a person's.
//
//   node tests/acceptance/3472/call-text.mjs
import { callText, plainSentences, read } from './helpers.mjs';

const design = read();
console.log(`States people see gained ${design.gained.length} sentences and table cells:`);
for (const piece of design.gained) console.log(`  ${piece}`);
console.log('The plain-words line under Later, as extensions:');
for (const piece of new Set(plainSentences(design.later, design.states.anchors))) console.log(`  ${piece}`);
console.log(`"text": ${JSON.stringify(callText(design), null, 1)}`);
