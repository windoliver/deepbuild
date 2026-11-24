// A plan's steps as the asks core holds and compares them (#69).
import { canonicalize, sha256Hex } from '@deepbuild/contracts';
import type { JsonValue } from '@deepbuild/contracts';
import { CANT_UNDO, isObj, type PlanStep } from './model.js';

/** A step as a plan holds it: one with no undo marked can't undo. */
export const markStep = (step: PlanStep): PlanStep => (isObj(step) && (step.undo === null || step.undo === '') ? { ...step, undo: CANT_UNDO } : step);
/** Two steps are the same step when every field is. */
export const sameStep = (a: PlanStep, b: PlanStep): boolean => sha256Hex(canonicalize(a as unknown as JsonValue)) === sha256Hex(canonicalize(b as unknown as JsonValue));
