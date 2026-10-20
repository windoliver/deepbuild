// The spike's one entry (#56): `--variant plain|effect` picks the build, which reads the rest of
// the arguments. Each build runs from its .ts sources under Node's type stripping, so stack traces
// name the source file and line.
const at = process.argv.indexOf('--variant');
const variant = at > 0 ? process.argv[at + 1] : undefined;
if (variant !== 'plain' && variant !== 'effect') {
  console.error('usage: node spikes/hub-core/hub.mjs --variant <plain|effect> --state <dir> --ports <first>-<last> [--extension <module>]... [--clock virtual]');
  process.exit(2);
}
const { main } = await import(`./${variant}/main.ts`);
await main(process.argv.slice(2).filter((_, index, args) => args[index] !== '--variant' && args[index - 1] !== '--variant'));
