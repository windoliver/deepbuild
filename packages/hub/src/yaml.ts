// A hub with no repo spec has no YAML to read. Keep the synchronous public parser off startup's module graph.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const yaml = (): typeof import('yaml') => require('yaml') as typeof import('yaml');
export const parseYaml = (text: string): unknown => yaml().parse(text);
