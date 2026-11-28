export interface Edit { key: string; column: string; expect: number | null; to: string }
export interface Plan { key: string; edits: Edit[] }
export function parseCsv(text: string): string[][];
export function spoil(text: string, plan: Plan | null | undefined): string | null;
