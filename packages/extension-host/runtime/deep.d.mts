import type { Duplex } from 'node:stream';

export interface ApiMethod { method: string; needs: string | null }
export const API: readonly ApiMethod[];

/** `scope` is the action call a package's call is made for, when it is made while serving one. */
export type Call = (method: string, params: unknown[], scope?: string) => Promise<unknown>;
export type Serve = (method: string, params: any, scope?: string) => Promise<unknown>;
export function extensionSide(call: Call, load: (deep: unknown, params: any) => Promise<unknown>): { serve: Serve };
export function peer(stream: Duplex, serve: Serve): { call(method: string, params: unknown, scope?: string): Promise<unknown> };
