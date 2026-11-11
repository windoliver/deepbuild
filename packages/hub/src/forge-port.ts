// Forge observation and credentials. Gate and session identities remain separate capabilities.
export interface AppKey { app_id: number; key(): Promise<string | undefined> }
interface ForgeSession { id: string; agent: string; cwd: string }
export interface ForgeObserver { verdicts(): void; pass(): Promise<void> }
export interface ForgeOptions {
  api: string;
  reads(): Promise<string | undefined>;
  posts(repo: string): Promise<string | undefined>;
  settings(): { delivery: Record<string, unknown>; yours: string[] };
  raw(query: string, params?: (string | number | null)[]): Promise<unknown[]>;
  sessions(): ForgeSession[];
  unguarded(session: ForgeSession | undefined, data: { ref: string; commit: string; pusher: string | null; call: string | null; command: string | null }): Promise<void>;
  pushed(repo: string, change: { ref: string; commit: string; pusher: string | null }): Promise<void>;
  hear(session: ForgeSession, text: string): void;
  state: string;
  snapshots: string;
  plant?: 'posts-on-head' | 'unguarded-marks-every-push' | 'unguarded-marks-none';
}
export interface SessionCredentials {
  repoOf(remote: string): string | undefined;
  sessionToken(api: string, app: AppKey, repo: string, statuses?: boolean): Promise<{ token: string; login: string | null }>;
  revoke(api: string, token: string): Promise<void>;
}
export interface ForgeProvider extends SessionCredentials {
  open(options: ForgeOptions): ForgeObserver;
  gateTokens(api: string, app: () => AppKey | undefined, landing?: boolean): (repo: string) => Promise<string | undefined>;
}
