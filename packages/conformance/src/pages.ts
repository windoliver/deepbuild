// deep://codes/<code> (#313, AC16): the page for a code, generated from its code family's schema and the kit's
// planted entry, so it can't drift from what the code does. A code no family lists has no page.
import { ContractError } from '@deepbuild/contracts';
import { codeFamilies } from './families.js';
import { plantedEntries } from './kit.js';
import type { CodesPage } from './types.js';

const SCHEME = 'deep://codes/';

/** The page at a deep://codes/<code> URI; refuses another scheme at /uri and an unlisted code at /code. */
export function codesPage(uri: string): CodesPage {
  if (!uri.startsWith(SCHEME)) throw new ContractError({ code: 'handle_scheme', retryable: false, remediation: 'Read codes at deep://codes/<code>.', path: '/uri', actual: uri, evidence: [] });
  const code = uri.slice(SCHEME.length);
  const family = codeFamilies().find((f) => f.codes.includes(code));
  const entry = family && plantedEntries().find((e) => e.family === family.family && e.code === code);
  if (!family || !entry) throw new ContractError({ code: 'enum', retryable: false, remediation: 'Read a code one of the code families lists.', path: '/code', actual: code, evidence: [] });
  const markdown = [
    `# ${code}`,
    '',
    `A ${family.family} code, listed by \`${family.schema}\` at \`${family.pointer || '/'}\`.`,
    '',
    '## Planted entry',
    '',
    'Raises this code alone when the kit replays it:',
    '',
    '```json',
    JSON.stringify(entry.entry),
    '```',
    '',
    '## Clean twin',
    '',
    'Raises nothing:',
    '',
    '```json',
    JSON.stringify(entry.twin.value),
    '```',
    '',
    '## Fix',
    '',
    entry.fix,
    '',
  ].join('\n');
  return { uri, code, family: family.family, schema: family.schema, entry, markdown };
}
