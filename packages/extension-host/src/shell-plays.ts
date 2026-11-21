// #851: what a shell.journeys check's input lets deep.canvas.play play (Check input: shell journeys): a run's journey,
// device and size must be ones the input gives, and its level policy, pause and budget the input's own.

/** A shell.journeys input's journeys, devices and sizes, and the level policy, pause and budget each run takes. */
export interface ShellInput { journeys?: unknown; devices?: unknown; sizes?: unknown; level?: unknown; pause?: unknown; budget?: unknown }

import { canonicalize, type JsonValue } from '@deepbuild/contracts';

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A value as canonical JSON, so two values parsed apart compare; nothing (an absent field) as its own word. */
const canonical = (v: unknown): string => (v === undefined ? 'undefined' : Buffer.from(canonicalize(v as JsonValue)).toString('utf8'));

/** #851's journeys, devices and sizes when a shell.journeys input names none. */
const SHELL_ALL = {
  journeys: ['title_to_level', 'unlock', 'carry', 'pause', 'credits', 'back', 'focus', 'prompts', 'layout', 'wired'],
  devices: ['keys', 'pad', 'touch'],
  sizes: [[1512, 982], [2400, 1080]],
};
/** Why a run's shell isn't one the shell.journeys input gives, or nothing (#851). */
export function shellRefusal(input: ShellInput, shell: unknown): string | undefined {
  const s = (isPlain(shell) ? shell : {}) as Record<string, unknown>;
  const list = (v: unknown, all: unknown[]): string[] => (Array.isArray(v) ? v : all).map(canonical);
  if (!list(input.journeys, SHELL_ALL.journeys).includes(canonical(s.journey))) return `the journey ${String(s.journey)} isn't one it gives`;
  if (!list(input.devices, SHELL_ALL.devices).includes(canonical(s.device))) return `the device ${String(s.device)} isn't one it gives`;
  if (!list(input.sizes, SHELL_ALL.sizes).includes(canonical(s.size))) return `the size ${canonical(s.size)} isn't one it gives`;
  for (const k of ['level', 'pause', 'budget'] as const) if (s[k] !== undefined && canonical(s[k]) !== canonical(input[k])) return `its ${k} isn't the one it gives`;
  return undefined;
}
