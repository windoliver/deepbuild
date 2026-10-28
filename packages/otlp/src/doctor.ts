// The receiver's `deep doctor` item (#42): each agent's telemetry protocol and address, read from its
// settings the way the agent reads them, and flagged, naming the setting, when the receiver can't read them.
// Claude Code reads OTEL variables from the environment it starts in, then the `env` block of its user
// settings, then managed settings, each over the last; it ignores them in a repo's `.claude/settings.json`,
// so this never reads one.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface DoctorItem {
  item: 'otlp.telemetry';
  agent: 'claude-code';
  code: 'healthy' | 'telemetry_unreadable' | 'not_checked';
  level: 'ok' | 'fail' | 'skip';
  evidence: string;
  fix: string;
}

const MANAGED = process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode/managed-settings.json' : '/etc/claude-code/managed-settings.json';
const SIGNALS = ['traces', 'logs'] as const;
const READABLE = new Set(['http/protobuf', 'http/json']);

interface Setting { value: string; from: string }
const OTLP_PATHS = new Set(['/', '/v1/traces', '/v1/logs']);
/** An endpoint as evidence shows it: its scheme, host and port, and its path only when it is one OTLP uses; a
 *  user, password, other path, query or fragment may carry a secret, and a value that isn't a URL may be one. */
function redact(endpoint: string): string {
  let url: URL;
  try { url = new URL(endpoint); } catch { return '<redacted: not a URL>'; }
  const user = url.username || url.password ? 'redacted@' : '';
  const path = OTLP_PATHS.has(url.pathname) ? url.pathname : '/redacted';
  return `${url.protocol}//${user}${url.host}${path}${url.search ? '?redacted' : ''}${url.hash ? '#redacted' : ''}`;
}
function envBlock(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const env = (JSON.parse(readFileSync(path, 'utf8')) as { env?: unknown }).env;
    return typeof env === 'object' && env !== null && !Array.isArray(env) ? (env as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The OTLP receiver's item for Claude Code, from `env` (the shell Claude Code starts from) and its settings files. */
export function doctor(env: NodeJS.ProcessEnv): DoctorItem[] {
  const port = 4318;
  const settings = new Map<string, Setting>();
  const layer = (vars: Record<string, unknown>, from: string) => {
    for (const [name, value] of Object.entries(vars)) if (typeof value === 'string' && /^(OTEL_|CLAUDE_CODE_ENABLE_TELEMETRY$)/.test(name)) settings.set(name, { value, from });
  };
  layer(env, 'the shell');
  layer(envBlock(join(env.CLAUDE_CONFIG_DIR ?? join(env.HOME ?? homedir(), '.claude'), 'settings.json')), "Claude Code's settings.json");
  layer(envBlock(env.DEEP_HUB_TEST_MANAGED_SETTINGS || MANAGED), 'managed settings');
  const shown = (name: string): string => {
    const s = settings.get(name);
    return s ? `${name}=${name.endsWith('_ENDPOINT') ? redact(s.value) : s.value} (${s.from})` : `${name}=(unset)`;
  };
  const item = (code: DoctorItem['code'], level: DoctorItem['level'], evidence: string, fix: string): DoctorItem[] => [{ item: 'otlp.telemetry', agent: 'claude-code', code, level, evidence, fix }];
  const receiver = `http://127.0.0.1:${port}`;

  if (settings.get('CLAUDE_CODE_ENABLE_TELEMETRY')?.value !== '1') {
    return item('not_checked', 'skip', `${shown('CLAUDE_CODE_ENABLE_TELEMETRY')}: Claude Code exports no telemetry, so there is no protocol or address to read`,
      `To send Claude Code's telemetry to the receiver, set CLAUDE_CODE_ENABLE_TELEMETRY=1, OTEL_LOGS_EXPORTER=otlp, OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf and OTEL_EXPORTER_OTLP_ENDPOINT=${receiver} in its settings.json env.`);
  }
  const exporting = SIGNALS.filter((s) => (settings.get(`OTEL_${s.toUpperCase()}_EXPORTER`)?.value ?? '').split(',').map((v) => v.trim()).includes('otlp'));
  if (!exporting.length) {
    return item('telemetry_unreadable', 'fail', `${shown('OTEL_LOGS_EXPORTER')}, ${shown('OTEL_TRACES_EXPORTER')}: Claude Code sends the receiver neither logs nor traces`,
      'Set OTEL_LOGS_EXPORTER=otlp (request cost) and OTEL_TRACES_EXPORTER=otlp with CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1 (tool spans).');
  }
  const problems: string[] = [], read: string[] = [];
  for (const signal of exporting) {
    const S = signal.toUpperCase();
    const protocolVar = settings.has(`OTEL_EXPORTER_OTLP_${S}_PROTOCOL`) ? `OTEL_EXPORTER_OTLP_${S}_PROTOCOL` : 'OTEL_EXPORTER_OTLP_PROTOCOL';
    const protocol = settings.get(protocolVar)?.value;
    if (protocol === undefined || !READABLE.has(protocol)) problems.push(`${shown(protocolVar)} for ${signal}: the receiver reads http/protobuf or http/json, not ${protocol ?? 'an unset protocol'}`);
    // A signal's own endpoint is its whole URL; the generic one is a base the exporter adds /v1/<signal> to.
    const own = settings.has(`OTEL_EXPORTER_OTLP_${S}_ENDPOINT`);
    const endpointVar = own ? `OTEL_EXPORTER_OTLP_${S}_ENDPOINT` : 'OTEL_EXPORTER_OTLP_ENDPOINT';
    const endpoint = settings.get(endpointVar)?.value ?? 'http://localhost:4318';
    let url: URL | undefined;
    try { url = new URL(endpoint); } catch { url = undefined; }
    const path = own ? `/v1/${signal}` : '/';
    if (!url || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== String(port) || url.pathname !== path || url.search) {
      problems.push(`${settings.has(endpointVar) ? shown(endpointVar) : `${endpointVar}=(unset, so ${endpoint})`} for ${signal}: the receiver listens at ${receiver}${own ? path : ''} only`);
    }
    read.push(`${signal}: ${protocol} to ${redact(endpoint)}`);
  }
  if (problems.length) {
    return item('telemetry_unreadable', 'fail', problems.join('; '),
      `In Claude Code's settings.json env, set OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf and OTEL_EXPORTER_OTLP_ENDPOINT=${receiver}, and remove any per-signal protocol or endpoint that differs.`);
  }
  return item('healthy', 'ok', read.join('; '), 'Nothing: the receiver reads the telemetry Claude Code sends.');
}
