// The check.kind@1 wire result: runners and the host reject malformed reports at the same boundary.
import { RUN_OUTCOMES, type CheckResult } from './slot-types.js';

const strings = (v: unknown): boolean => Array.isArray(v) && v.every(s => typeof s === 'string');
const isFailure = (f: unknown): boolean => {
  const x = f as Record<string, unknown> | null;
  return typeof x === 'object' && x !== null && typeof x.test === 'string' && typeof x.file === 'string' && Number.isInteger(x.line)
    && (x.stack === null || typeof x.stack === 'string') && typeof x.assertion === 'boolean' && typeof x.message === 'string';
};
/** Every field of a closed run result; this checks its shape, never computes a verdict. */
export const isCheckResult = (r: unknown): r is CheckResult => {
  const x = r as Record<string, unknown> | null;
  return typeof x === 'object' && x !== null && (RUN_OUTCOMES as readonly unknown[]).includes(x.outcome) && Number.isInteger(x.testsRun) && (x.testsRun as number) >= 0
    && Array.isArray(x.failures) && x.failures.every(isFailure) && strings(x.evidence) && strings(x.read) && (x.mask === null || typeof x.mask === 'string');
};
