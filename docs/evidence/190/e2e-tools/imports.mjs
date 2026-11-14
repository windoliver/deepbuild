// Lists each web_plan item's rewritten program in a web-replies.jsonl with its sha256 and WebAssembly imports:
// `node imports.mjs <web-replies.jsonl>`. Criterion 1: a merged program imports nothing.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
for (const [i, line] of readFileSync(process.argv[2], 'utf8').trim().split('\n').entries()) {
  for (const item of JSON.parse(line).request?.items ?? []) {
    const bytes = Buffer.from(item.rewritten, 'base64');
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(bytes));
    console.log(`line ${i + 1} ${item.id} sha256 ${createHash('sha256').update(bytes).digest('hex')} imports ${JSON.stringify(imports)}`);
  }
}
