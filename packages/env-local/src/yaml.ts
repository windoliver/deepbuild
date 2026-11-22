// The environment's parser is needed only once a stack actually has a spec to read.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const parse = (text: string): unknown => (require('yaml') as typeof import('yaml')).parse(text);
