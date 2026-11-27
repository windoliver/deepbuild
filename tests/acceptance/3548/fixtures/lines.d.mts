// Types of lines.mjs, which the hub's process loads as it is and helpers.ts imports.
export const HEAD: string;
export const OPEN: string;
export const CLOSE: string;
export const FIXED: number;
export function pad(number: number): string;
export function fillOf(number: number, length: number): string;
export function textOf(tag: string, number: number, length: number): string;
export function lineOf(tag: string, number: number, length: number): string;
export function fillAt(number: number, least?: number): number;
export function plantedIn(text: string, tag: string): { whole: number[]; part: boolean };
