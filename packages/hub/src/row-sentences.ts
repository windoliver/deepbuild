import { readFileSync } from 'node:fs';

let templates: Record<string, string> | undefined;

export function say(name: string, ...fills: readonly (string | number)[]): string {
  templates ??= (JSON.parse(readFileSync(new URL('../row-sentences.json', import.meta.url), 'utf8')) as { templates: Record<string, string> }).templates;
  const text = templates[name];
  if (text === undefined) throw Error(`packages/hub/row-sentences.json holds no template ${name}`);
  return text.replace(/\{(\d+)\}/g, (_, at: string) => String(fills[Number(at)]));
}
