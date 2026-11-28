import type { JsonValue } from '@deepbuild/contracts';

type Obj = { [key: string]: JsonValue };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface Turn {
  id: string; text: string; outside: boolean; role?: string; tool?: string;
  of?: string; error?: boolean;
}
export interface TranscriptReader { start(): (line: unknown, n: number) => Turn | undefined }

const OUTSIDE = /^(WebFetch|WebSearch|Glob|Grep|Task|Agent|mcp__.+)$/;
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

function codexCommand(p: Obj): string | undefined {
  let args: unknown = p.arguments;
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { return undefined; } }
  if (isObj(args)) {
    const c = args.cmd ?? args.command;
    return typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => typeof x === 'string').join(' ').replace(/^\S*sh -lc /, '') : undefined;
  }
  const quoted = typeof p.input === 'string' ? /\bcmd:\s*("(?:[^"\\]|\\.)*")/.exec(p.input)?.[1] : undefined;
  if (quoted === undefined) return undefined;
  try { return JSON.parse(quoted) as string; } catch { return undefined; }
}
function codexFailed(output: string): boolean {
  const code = /Process exited with code (\d+)/.exec(output)?.[1] ?? /"exit_code"\s*:\s*(\d+)/.exec(output)?.[1];
  return code !== undefined ? code !== '0' : /^Script failed/.test(output);
}
const texts = (content: unknown): string[] => (Array.isArray(content) ? content : []).flatMap((c) => (isObj(c) && typeof c.text === 'string' ? [c.text] : []));

const codexTranscript: TranscriptReader = {
  start() {
    const calls = new Map<string, string>();
    const said = new Set<string>();
    return (line, n) => {
      if (!isObj(line) || line.type !== 'response_item' || !isObj(line.payload)) return undefined;
      const p = line.payload;
      if (p.type === 'message') {
        const bare = typeof p.id === 'string' ? p.id.replace(/^msg_/, '') : '';
        const id = SAFE_ID.test(bare) ? bare : `l${n}`;
        return { id, text: texts(p.content).join('\n'), outside: p.role !== 'user', ...(typeof p.role === 'string' ? { role: p.role } : {}) };
      }
      if (typeof p.call_id !== 'string' || !SAFE_ID.test(p.call_id)) return undefined;
      const call = p.call_id;
      if (p.type === 'function_call' || p.type === 'custom_tool_call') {
        calls.set(call, typeof p.name === 'string' ? p.name : '');
        const command = codexCommand(p);
        if (command === undefined) return undefined;
        said.add(call);
        return { id: call, text: command, outside: true, role: 'assistant' };
      }
      if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
        const out = typeof p.output === 'string' ? p.output : texts(p.output).join('\n');
        const tool = calls.get(call) ?? '';
        return { id: `${call}.out`, text: out, outside: tool === '' || OUTSIDE.test(tool), role: 'user', tool, error: codexFailed(out), ...(said.has(call) ? { of: call } : {}) };
      }
      return undefined;
    };
  },
};

function messages(idOf: (line: Obj, n: number) => string | undefined): TranscriptReader {
  return {
    start() {
      const tools = new Map<string, string>();
      const calls = new Map<string, string>();
      return (line, n) => {
        if (!isObj(line) || !isObj(line.message)) return undefined;
        const id = idOf(line, n);
        if (id === undefined) return undefined;
        const role = line.message.role ?? line.role;
        const content = line.message.content;
        const parts: string[] = [];
        let outside = role === 'assistant' || line.isCompactSummary === true || line.isSidechain === true || line.isMeta === true;
        let called: string | undefined;
        let answers: string | undefined;
        let failed: boolean | undefined;
        if (typeof content === 'string') parts.push(content);
        else if (Array.isArray(content)) {
          for (const block of content) {
            if (!isObj(block)) continue;
            if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
            if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
              tools.set(block.id, block.name);
              if (block.name === 'Bash' && isObj(block.input) && typeof block.input.command === 'string') { parts.push(block.input.command); calls.set(block.id, id); }
            }
            if (block.type === 'tool_result') {
              const tool = tools.get(String(block.tool_use_id));
              if (tool === undefined || OUTSIDE.test(tool)) outside = true;
              called = tool ?? '';
              answers = calls.get(String(block.tool_use_id));
              failed = block.is_error === true;
              if (typeof block.content === 'string') parts.push(block.content);
              else parts.push(...texts(block.content));
            }
          }
        }
        return { id, text: parts.join('\n'), outside, ...(typeof role === 'string' ? { role } : {}), ...(called === undefined ? {} : { tool: called }), ...(answers === undefined ? {} : { of: answers }), ...(failed === undefined ? {} : { error: failed }) };
      };
    },
  };
}
const claudeTranscript = messages((line) => (typeof line.uuid === 'string' ? line.uuid : undefined));
const piTranscript = messages((line) => (typeof line.uuid !== 'string' && line.type === 'message' && typeof line.id === 'string' ? line.id : undefined));
const cursorTranscript = messages((line, n) => (typeof line.uuid !== 'string' && !(line.type === 'message' && typeof line.id === 'string') && typeof line.role === 'string' ? `l${n}` : undefined));
export const transcriptReaders: readonly TranscriptReader[] = [codexTranscript, claudeTranscript, piTranscript, cursorTranscript];
