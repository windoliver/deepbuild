/** A ULID at an integer millisecond: 48 bits of time and 80 bits of entropy (20 hex digits or fresh randomness). */
export declare function ulid(ms: number, hex?: string): string;
/** The timestamp of an already validated ULID, in milliseconds. */
export declare function ulidTime(id: string): number;
