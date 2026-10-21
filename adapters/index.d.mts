export interface Reading { code: string; field: string; version: string }
export interface MappedEvent { kind: string; data: Record<string, unknown>; rule: string }
export interface MappedPayload { events: MappedEvent[]; verified: boolean; readings: Reading[] }
export interface Replayed {
  payloads: MappedPayload[];
  verified: boolean;
  readings: Reading[];
}
export function mapHook(input: { facts: unknown; version: string; payload: Record<string, unknown>; transcript?: readonly Record<string, unknown>[]; turns?: Set<unknown> }): MappedPayload;
export function replaySession(input: { facts: unknown; version: string; payloads: Record<string, unknown>[]; transcript?: Record<string, unknown>[] }): Replayed;
