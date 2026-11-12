// Source declarations and wire values, shared without importing the source owner.
/** One outside call the hub makes for a source, as it hands it to its HTTP client. */
export interface HttpRequest { url: string; method: string; headers: Record<string, string>; body?: string; /** A file's bytes (#1731): the answer's body as base64. */ encoding?: 'base64'; /** A binary recording refers to its downloaded bytes, never retains every chunk in memory. */ recording?: { file: string; offset: number } }
/** What came back, as the client got it: header names lower-case, a 3xx as it is, with its Location. */
export interface HttpAnswer { status: number; headers: Record<string, string>; body: string; partial?: true; refused?: 'range_not_supported' | 'invalid_range_response' }
/** The hub's HTTP client for source calls: it never follows a redirect, rejects when the host can't be reached, and stops when `signal` aborts. */
export type HttpClient = (request: HttpRequest, signal: AbortSignal) => Promise<HttpAnswer>;
/** The OS secret store as the hub reaches it (the Keychain on macOS). */
export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
/** One source call as recorded: no form of any secret value anywhere in it. */
export interface RecordedCall { source: string; request: HttpRequest; answer: HttpAnswer | { error: 'timeout' | 'unreachable' | 'asset_refused' } }
export interface Recording { v: 1; calls: RecordedCall[] }
/** A reading: the parser's value and unit, with the source and the as-of time of the call that fetched it. */
export interface Reading { source: string; value: number; unit: string; as_of: number }
/** A series call's values, kept in one evidence file named by one reading.batch event (#262). */
export interface Batch { handle: string; source: string; as_of: number; file: string; count: number }
/** A read: a number's reading, a series' batch, or why there is none; `until`, when the quota refused it, is when it can run. */
export type SourceRead = { status: 'reading'; reading: Reading } | { status: 'batch'; batch: Batch } | { status: 'BLOCKED' | 'failed'; source: string; cause: string; until?: number };
export type KeyTest = 'valid' | 'invalid' | 'INCONCLUSIVE' | 'untested';
/** One event of a stream source, as source@1 has it. */
export interface StreamEvent { seq: number; kind: string; data: unknown }
export type StreamRead = { status: 'events'; source: string; events: StreamEvent[] } | { status: 'BLOCKED' | 'failed'; source: string; cause: string };

/** A polled source as its package declared it, checked: functions stay with the package. */
export interface Polled {
  variant: 'polled'; name: string; host: string; path: string;
  /** The secret's name in the manifest, or null for a source that needs none. */
  secret: string | null;
  auth: { header: string } | { basic: string } | { bearer: true } | null;
  /** Sign-in through an OAuth loopback (RFC 8252), its endpoints on the source's own host; the token is the secret. */
  oauth: { authorize: string; token: string; client: string; scope: string | null } | null;
  quota: { per_minute: number; per_day: number };
  timeout: number; freshFor: number;
  keyTest: { path: string } | null;
  /** A number, or a series of up to 10,000 named values a call (#262). */
  shape: 'number' | 'series';
  /** A cadence the hub runs only while a view that binds the source is shown (#262). */
  whileShown: { every: number } | null;
}
/**
 * A work source (#66): a stream source whose reading is work.item@1, read through the hub. Its provider calls go to its
 * host only, with its secret by handle, under its quota; `delivers` says what a delivery into its threads is.
 */
export interface WorkDecl { host: string; secret: string | null; auth: Polled['auth']; quota: { per_minute: number; per_day: number }; delivers: 'comment' | 'chat' | 'email' }
/**
 * A library source (#1731), asset.library@1's fill: its search and fetch run in the package, every call they make and
 * every byte of a picked asset going through the hub to its one host, with its secret by handle, its quota and timeout.
 */
export interface LibraryDecl extends Omit<WorkDecl, 'delivers'> { timeout: number }
export type Declared = Polled | { variant: 'stream'; name: string; work: WorkDecl | null } | { variant: 'library'; name: string; library: LibraryDecl };

/** A views/shown report, as the app sends it on the app API for each view it shows, at once and every 5 s (#262). */
export interface ViewShown { view: string; window: string; visible: boolean; minimized: boolean; display_awake: boolean; session_locked: boolean; replica: boolean }
/** A notice you created on a source, as the host keeps it beside its notice.subscribed (#262). */
export interface SavedNotice { kind: string; key: string; source: string; words: string; sentence: string; every: number | null; job?: string }
