import type { Duplex } from 'node:stream';

export interface ApiMethod { method: string; needs: string | null }
export const API: readonly ApiMethod[];

export type Call = (method: string, params: unknown[]) => Promise<unknown>;
export type Serve = (method: string, params: any) => Promise<unknown>;
export function extensionSide(call: Call, load: (deep: unknown, params: any) => Promise<void>): { serve: Serve };
export function peer(stream: Duplex, serve: Serve): { call(method: string, params: unknown): Promise<unknown> };
