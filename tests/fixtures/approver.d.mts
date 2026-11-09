// Types for the TypeScript suites that import approver.mjs.
export interface SecurityKey { name: string; line: string; signs(text: string): string }
export declare const APPROVERS: string;
export declare function securityKey(name: string): SecurityKey;
export declare function people(): { maintainer: SecurityKey; stranger: SecurityKey; list: string };
export declare function tag(cwd: string, ref: string, commit: string, items: string[], key: SecurityKey | null | undefined): void;
