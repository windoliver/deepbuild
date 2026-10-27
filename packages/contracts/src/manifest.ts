// The manifest contract (#314): extension.manifest@1's schema, then the two rules the closed node types can't
// write: a medium a panel uses needs its access word, and a name a plug-in adds (an event kind, a store kind, a
// check kind, a code, a notice kind, an action or an output interface) is ext.<plugin>.<name>, where the plug-in
// is the name part of the package's owner/name id, unless the package declares that it replaces the shipped
// piece of that name (technical-design.md, What a minor may change). Each refusal is an error@1 issue at the
// JSON Pointer of the offending value, with the word or name as the value refused. The contract holds the
// manifest's shape and its own consistency only: whether a replaced piece exists, and whether this package may
// replace it, is the install's decision against what is installed (two pieces can't fill one slot; a replacing
// view passes the replaced view's kit), so a `replaces` entry here is a declaration the hub checks, not a grant.
import { issue, type ContractIssue } from './errors.js';
import { validate } from './schemas.js';
import type { Validation } from './validate.js';

const MANIFEST = 'extension.manifest@1';
/** The lists of names a plug-in adds, each under the prefix rule. */
const NAME_LISTS = ['events', 'stores', 'checks', 'codes', 'notices', 'actions'] as const;
/** What follows the prefix: one name, as a device class's does. */
const OWN_NAME = /^[a-z][a-z0-9_]*$/;

interface Panel { media?: string[] }
interface Provided { interface: string }
interface Manifest {
  id: string;
  access?: { words: string[] };
  panels?: Panel[];
  provides?: Provided[];
  replaces?: string[];
  events?: string[];
  stores?: string[];
  checks?: string[];
  codes?: string[];
  notices?: string[];
  actions?: string[];
  environments?: string[];
}

/** Whether a name is the plug-in's own: ext.<plugin>.<name>, with `@major` allowed for an interface. */
function own(name: string, plugin: string, withMajor: boolean): boolean {
  const prefix = `ext.${plugin}.`;
  if (!name.startsWith(prefix)) return false;
  const rest = name.slice(prefix.length);
  const at = rest.indexOf('@');
  if (at < 0) return OWN_NAME.test(rest);
  return withMajor && OWN_NAME.test(rest.slice(0, at)) && /^[1-9][0-9]*$/.test(rest.slice(at + 1));
}

/** Hook context templates (#350): a manifest's `templates`, each a hook.template@1 whose text names only its fields. */
const TEMPLATE = 'hook.template@1';
function checkTemplates(templates: unknown): ContractIssue[] {
  if (!Array.isArray(templates)) return [issue('type', '/templates', templates)];
  const names = new Set<string>();
  return templates.flatMap((t, i): ContractIssue[] => {
    const held = validate(TEMPLATE, t);
    if (!held.ok) return held.issues.map((x) => ({ ...x, path: `/templates/${i}${x.path}` }));
    const { name, text, fields } = t as { name: string; text: string; fields: Record<string, unknown> };
    const found: ContractIssue[] = [];
    if (names.has(name)) found.push(issue('enum', `/templates/${i}/name`, name));
    names.add(name);
    for (const [, field] of text.matchAll(/\{([^{}]*)\}/g)) if (!Object.hasOwn(fields, field!)) found.push(issue('required', `/templates/${i}/fields`, field));
    return found;
  });
}

/** The environments a package registers through `deep.registerEnvironment` (#331): a list of names. */
const ENVIRONMENT_NAME = /^[a-z][a-z0-9_.-]*$/;
function checkEnvironments(environments: unknown): ContractIssue[] {
  if (!Array.isArray(environments)) return [issue('type', '/environments', environments)];
  return environments.flatMap((name, i): ContractIssue[] => (typeof name === 'string' && ENVIRONMENT_NAME.test(name) ? [] : [issue('pattern', `/environments/${i}`, name)]));
}

/** The manifest contract as one Validation: the schema's refusals, or else the rules the schema can't hold. */
export function checkManifest(value: unknown): Validation {
  // Read beside extension.manifest@1, whose frozen shape doesn't list them: `templates` is hook.template@1's,
  // `environments` the environment slot's (#331), `conflicts` and `kernel` are extension.edges@1's and `signature` is
  // package.signature@1's (#351). Each sits at the manifest's root, so its issues' paths are the manifest's.
  const object = typeof value === 'object' && value !== null && !Array.isArray(value);
  const { templates, environments, conflicts, kernel, signature, ...rest } = object ? value as Record<string, unknown> : {};
  const held = validate(MANIFEST, object ? rest : value);
  if (!held.ok) return held;
  const beside = (schema: string, fields: Record<string, unknown>): ContractIssue[] => {
    const present = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    if (!Object.keys(present).length) return [];
    const result = validate(schema, present);
    return result.ok ? [] : result.issues;
  };
  const m = value as Manifest;
  const issues: ContractIssue[] = [
    ...(templates === undefined ? [] : checkTemplates(templates)),
    ...(environments === undefined ? [] : checkEnvironments(environments)),
    ...beside('extension.edges@1', { conflicts, kernel }),
    ...beside('package.signature@1', { signature }),
  ];
  const words = new Set(m.access?.words ?? []);
  (m.panels ?? []).forEach((panel, i) => {
    (panel.media ?? []).forEach((medium, j) => { if (!words.has(medium)) issues.push(issue('required', `/panels/${i}/media/${j}`, medium)); });
  });
  const plugin = m.id.slice(m.id.indexOf('/') + 1);
  const replaces = new Set(m.replaces ?? []);
  for (const list of NAME_LISTS) {
    (m[list] ?? []).forEach((name, i) => { if (!replaces.has(name) && !own(name, plugin, false)) issues.push(issue('pattern', `/${list}/${i}`, name)); });
  }
  (m.provides ?? []).forEach((provided, i) => {
    if (!replaces.has(provided.interface) && !own(provided.interface, plugin, true)) issues.push(issue('pattern', `/provides/${i}/interface`, provided.interface));
  });
  return issues.length ? { ok: false, issues } : { ok: true };
}
