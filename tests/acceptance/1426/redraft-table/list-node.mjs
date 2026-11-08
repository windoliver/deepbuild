// #1426's real-tree judge reads a node --test file's own test list with this preload: `node --import <this> <file>`.
// It stands a recorder in for node:test, so the file registers its top-level tests by name and none of them runs.
// Each name prints as `LISTED <json string>` when the file has loaded.
import { registerHooks } from 'node:module';

const recorder = `const names = [];
process.on('exit', () => { for (const name of names) process.stdout.write('LISTED ' + JSON.stringify(name) + '\\n'); });
const record = (name) => { if (typeof name === 'string') names.push(name); return Promise.resolve(); };
const test = (name) => record(name);
for (const key of ['skip', 'todo', 'only']) test[key] = record;
export default test;
export { test, test as it, test as describe, test as suite };
export const before = () => {}, after = () => {}, beforeEach = () => {}, afterEach = () => {}, mock = {};`;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'node:test') return { url: `data:text/javascript,${encodeURIComponent(recorder)}`, shortCircuit: true };
    return next(specifier, context);
  },
});
