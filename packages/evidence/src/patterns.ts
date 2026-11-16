// gitleaks v8.30.1, MIT License, Copyright (c) 2019 Zachary Rice; see ../gitleaks/LICENSE.
// build-patterns.mjs converts the unchanged TOML at build, so every thread reads the same ready-to-use rules.
import { readFileSync } from 'node:fs';

export interface Rule {
  id: string;
  regex: RegExp;
  keywords: string[];
  /** The capture group holding the secret; 0 redacts the whole match. */
  group: number | 'first';
  /** The pattern can span lines, so it reads past the line its keyword is on. */
  multiline: boolean;
}

export function loadRules(): Rule[] {
  const rules = JSON.parse(readFileSync(new URL('../dist/patterns.json', import.meta.url), 'utf8')) as (Omit<Rule, 'regex'> & { regex: string })[];
  return rules.map((rule) => ({ ...rule, regex: new RegExp(rule.regex, 'dg') }));
}
