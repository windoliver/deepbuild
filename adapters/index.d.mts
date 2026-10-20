export interface Reading { code: string; field: string; version: string }
export interface MappedEvent { kind: string; data: Record<string, unknown>; rule: string }
export interface Replayed {
  payloads: { events: MappedEvent[]; verified: boolean; readings: Reading[] }[];
  verified: boolean;
  readings: Reading[];
}
export function replaySession(input: { facts: unknown; version: string; payloads: Record<string, unknown>[]; transcript?: Record<string, unknown>[] }): Replayed;
