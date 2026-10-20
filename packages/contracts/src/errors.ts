import { readFileSync } from 'node:fs';

/** How much of a refused value an error carries. */
const READ_CAP = 8192;

const REMEDIATION: Record<string, string> = {
  unknown_schema: 'Name a published contract schema.',
  not_json: 'Send one JSON text.',
  type: 'Send the type the schema names at this path.',
  required: 'Add the field the schema requires.',
  unlisted_field: 'Remove the field, or connect with the contract version that lists it.',
  enum: 'Send one of the values the schema lists.',
  const: 'Send the value the schema fixes.',
  pattern: "Send a value that matches the field's pattern.",
  format: "Send the value in the field's format.",
  length: "Send a value within the field's length bounds.",
  range: "Send a value within the field's range.",
  union: "Set the union's tag to one of its listed values.",
  uncatalogued_kind: "Bind to an event kind in the catalogue, or add the kind's schema.",
  handle_syntax: 'Write the handle as <scheme>:<id>[#<fragment>].',
  handle_scheme: 'Use a handle scheme from the closed list.',
  digest_algorithm: "Write the digest as d1:<64 lower-case hex>, naming its algorithm.",
};

/** The closed set of codes, as the error@1 schema lists them; each has its remediation above. */
export const ERROR_CODES: readonly string[] = (() => {
  const schema = JSON.parse(readFileSync(new URL('../schemas/error@1.json', import.meta.url), 'utf8')) as {
    properties: { code: { enum: string[] } };
  };
  const codes = schema.properties.code.enum;
  const unmatched = [...codes.filter((code) => !(code in REMEDIATION)), ...Object.keys(REMEDIATION).filter((code) => !codes.includes(code))];
  if (unmatched.length) throw Error(`error@1 and the remediations disagree on ${unmatched.join(', ')}`);
  return Object.freeze([...codes]);
})();

/** One refusal, in the shape every error shares. */
export interface ContractIssue {
  code: string;
  retryable: boolean;
  remediation: string;
  path: string;
  actual: string;
  evidence: string[];
}

/** A refused value as text; one that isn't JSON (a cycle, a bigint) still gets some text, never a throw. */
function readable(actual: unknown): string {
  if (typeof actual === 'string') return actual;
  if (actual === undefined) return '';
  try {
    return JSON.stringify(actual, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)) ?? String(actual);
  } catch {
    try {
      return String(actual);
    } catch {
      // An object with no prototype, or a proxy, may have no text at all.
      return Object.prototype.toString.call(actual);
    }
  }
}

export function issue(code: string, path: string, actual: unknown): ContractIssue {
  // Half a surrogate pair shows as U+FFFD, so the text is JSON; then the cut keeps whole code points.
  let text = readable(actual).replace(/\p{Surrogate}/gu, '\uFFFD').slice(0, READ_CAP);
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  return { code, retryable: false, remediation: REMEDIATION[code]!, path, actual: text, evidence: [] };
}

export class ContractError extends Error implements ContractIssue {
  readonly code: string;
  readonly retryable: boolean;
  readonly remediation: string;
  readonly path: string;
  readonly actual: string;
  readonly evidence: string[];

  constructor(found: ContractIssue) {
    super(`${found.code} at ${found.path || '/'}: ${found.actual}`);
    this.code = found.code;
    this.retryable = found.retryable;
    this.remediation = found.remediation;
    this.path = found.path;
    this.actual = found.actual;
    this.evidence = found.evidence;
  }
}

// On the prototype, so an error's own fields are exactly error@1's.
Object.defineProperty(ContractError.prototype, 'name', { value: 'ContractError' });
