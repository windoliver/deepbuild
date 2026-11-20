// Issue #2175's attribution: every symbol the release deep-hook imports (`nm -u`), the functions in the binary that
// call or load it, and which of three forward paths call it. Run from the repo root on macOS (arm64) with cargo and
// clang on PATH:
//   node docs/spikes/2175/imports.mjs           prints one JSON object: record.json's `imports`
//   node docs/spikes/2175/imports.mjs table     prints the README's table rows from docs/spikes/2175/record.json
// Callers are read from the disassembly (`otool -tV`: each `bl` to a symbol stub, under the function label it sits in).
// Paths are traced: a dylib inserted with DYLD_INSERT_LIBRARIES interposes every imported function, logs the first
// call to each made from deep-hook's own __TEXT (libSystem calling itself isn't counted), and jumps on to the real
// function with the argument registers and the stack untouched. Each path runs once under it, in every process it
// starts: `--version`; a PreToolUse Read a stand-in hub answers (hello, acknowledgement, empty reply on
// ~/.deepbuild/hub.sock); and the same Read with no hub, which spools. ___stack_chk_guard is data, dyld_stub_binder
// and __tlv_bootstrap are called by dyld, and _bzero and _strlen crash the process when interposed alone (dyld or
// libSystem calls them where the trampoline can't run), so those five are read from their callers alone.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const NOT_TRACED = ['___stack_chk_guard', 'dyld_stub_binder', '__tlv_bootstrap', '_bzero', '_strlen'];
const PATHS = ['version', 'hubAnswers', 'hubAway'];

/** A Rust v0 or legacy mangled name as its path of identifiers: `std::sys::process::...::Command::spawn`. */
export function demangle(name) {
  let s = name.replace(/^_+/, '');
  if (!/^R|^ZN/.test(s)) return name;
  s = s.replace(/Cs[0-9A-Za-z]*_/g, ' ').replace(/^ZN|^R/, '');
  const parts = [];
  for (let i = 0; i < s.length;) {
    const m = /^(\d+)(_?)/.exec(s.slice(i));
    if (!m) { i++; continue; }
    const n = Number(m[1]);
    const id = s.slice(i + m[0].length, i + m[0].length + n);
    i += m[0].length + Math.max(n, 1);
    if (/^[A-Za-z_][\w$]*$/.test(id) && !/^h[0-9a-f]{16}$/.test(id)) parts.push(id);
  }
  return parts.join('::') || name;
}

/** The part of the program one calling function belongs to, by the first rule its path matches. */
function part(caller) {
  const rules = [
    [/process::unix|Command|Process::wait|sys::pipe/, "std's process spawning (`Command`)"],
    [/net::tcp|lookup_host|net::udp|socket_addr|getrandom|^_?ring|rustls|remote::connect|Pinned/, 'joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring)'],
    [/backtrace|personality|panic|rust_eh|begin_unwind/, 'panics and backtraces'],
    [/rt::lang_start|rt::cleanup|stack_overflow|thread_local|sys::exit|^main$|^_main$/, "std's runtime start and exit"],
    [/thread|sync::|Mutex|Once|ScopeData|mpsc|mpmc/, 'threads, locks and channels'],
    [/unix::net|net::connection::socket/, "the hub's Unix socket"],
    [/fs::|DirStream|ReadDir|File|canonicalize|current_dir|temp_dir|remove_file|rename|metadata|readlink/, 'files and folders'],
    [/__rdl_|alloc::alloc|__rust_alloc/, 'the allocator'],
    [/env::|sys::env|args|time::|io::error|os::unix::process|process::id|random/, "std's environment, time and errors"],
    [/^deep_hook|^deep_contracts/, "deep-hook's own code"],
  ];
  return rules.find(([re]) => re.test(caller))?.[1] ?? 'other';
}

/** The part a symbol comes with: the one part all its callers belong to, or "across the program". */
export function group(callers) {
  const parts = new Set(callers.map(part));
  if (parts.size === 1) return [...parts][0];
  if (parts.size === 0) return 'no caller in the binary (dyld or the linker uses it)';
  return `across the program (${[...parts].sort().join('; ')})`;
}

const sh = (c, a, opts = {}) => execFileSync(c, a, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
const importsOf = (bin) => sh('nm', ['-u', bin]).split('\n').map((s) => s.trim()).filter(Boolean);

function callers(bin, imports) {
  const found = new Map(imports.map((s) => [s, new Set()]));
  let fn = '?';
  for (const line of sh('otool', ['-tV', bin]).split('\n')) {
    if (/^\S.*:$/.test(line)) { fn = line.slice(0, -1); continue; }
    const m = line.match(/symbol stub for: (\S+)/);
    if (m && found.has(m[1])) found.get(m[1]).add(demangle(fn));
  }
  return found;
}

function tracer(imports, dir) {
  const syms = imports.filter((s) => !NOT_TRACED.includes(s));
  let c = `#include <stdint.h>
#include <string.h>
#include <crt_externs.h>
#include <mach-o/loader.h>
extern char *getenv(const char *);
extern int open(const char *, int, ...);
extern long write(int, const void *, unsigned long);
extern int close(int);
extern int getpid(void);
extern void *pthread_self(void);
static uintptr_t lo, hi;
__attribute__((constructor)) static void tracer_range(void) {
  const struct mach_header_64 *h = (const struct mach_header_64 *)_NSGetMachExecuteHeader();
  const struct load_command *lc = (const struct load_command *)(h + 1);
  for (uint32_t k = 0; k < h->ncmds; k++, lc = (const struct load_command *)((const char *)lc + lc->cmdsize))
    if (lc->cmd == LC_SEGMENT_64 && strncmp(((const struct segment_command_64 *)lc)->segname, "__TEXT", 16) == 0) {
      lo = (uintptr_t)h; hi = lo + ((const struct segment_command_64 *)lc)->vmsize;
    }
}
static volatile char seen[${syms.length}];
static const char *const names[${syms.length}] = {${syms.map((s) => JSON.stringify(s)).join(',')}};
__attribute__((used)) void tracer_hit(long i, uintptr_t ra) {
  if (seen[i] || ra < lo || ra >= hi) return;
  static void *volatile owner; void *self = pthread_self(); if (owner == self) return;
  while (!__sync_bool_compare_and_swap(&owner, (void *)0, self)) {}
  if (!seen[i]) {
    seen[i] = 1;
    const char *path = getenv("TRACE_LOG");
    char line[256]; int n = 0, pid = getpid(), d = 0; char digits[16];
    do { digits[d++] = '0' + pid % 10; pid /= 10; } while (pid);
    while (d) line[n++] = digits[--d];
    line[n++] = ' ';
    for (const char *p = names[i]; *p && n < 250; p++) line[n++] = *p;
    line[n++] = '\\n';
    int fd = path ? open(path, 0x0001 | 0x0008 | 0x0200, 0644) : -1; /* O_WRONLY|O_APPEND|O_CREAT */
    if (fd >= 0) { write(fd, line, n); close(fd); }
  }
  owner = 0;
}
`;
  syms.forEach((s, i) => {
    c += `extern void real_${i}(void) __asm__(${JSON.stringify(s)});
__attribute__((naked)) void wrap_${i}(void) {
  __asm__ volatile(
    "stp x0, x1, [sp, #-96]!\\n stp x2, x3, [sp, #16]\\n stp x4, x5, [sp, #32]\\n stp x6, x7, [sp, #48]\\n stp x8, x30, [sp, #64]\\n"
    "mov x0, #${i}\\n mov x1, x30\\n bl _tracer_hit\\n"
    "ldp x8, x30, [sp, #64]\\n ldp x6, x7, [sp, #48]\\n ldp x4, x5, [sp, #32]\\n ldp x2, x3, [sp, #16]\\n ldp x0, x1, [sp], #96\\n"
    "b ${s}\\n");
}
__attribute__((used, section("__DATA,__interpose"))) static const void *interpose_${i}[2] = { (const void *)wrap_${i}, (const void *)real_${i} };
`;
  });
  writeFileSync(join(dir, 'tracer.c'), c);
  sh('clang', ['-dynamiclib', '-O1', '-w', '-o', join(dir, 'tracer.dylib'), join(dir, 'tracer.c')]);
  return join(dir, 'tracer.dylib');
}

async function traced(bin, dylib, path) {
  const home = mkdtempSync(join(tmpdir(), 'deep-2175-trace-'));
  mkdirSync(join(home, '.deepbuild'));
  const log = join(home, 'trace.log');
  let server;
  let answered = 0;
  if (path === 'hubAnswers') {
    server = createServer((sock) => {
      sock.write('{"v":1}\n');
      let buf = '';
      sock.on('error', () => {});
      sock.on('data', (d) => {
        buf += d;
        const at = buf.indexOf('"id":"');
        if (at < 0 || !buf.includes('\n')) return;
        const id = buf.slice(at + 6, at + 32);
        answered++;
        sock.end(`{"v":1,"ack":"${id}","hold_until_ms":null}\n{"v":1,"exit":0,"stdout":"","stderr":""}\n`);
      });
    });
    await new Promise((r) => server.listen(join(home, '.deepbuild', 'hub.sock'), r));
  }
  const args = path === 'version' ? ['--version'] : ['claude-code', 'PreToolUse'];
  const input = path === 'version' ? '' : JSON.stringify({
    session_id: 'spike-2175', transcript_path: join(home, 'transcript.jsonl'), cwd: home,
    hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: join(home, 'a.txt') },
  });
  const exit = await new Promise((resolve) => {
    const child = spawn(bin, args, { env: { PATH: '/usr/bin:/bin', HOME: home, DYLD_INSERT_LIBRARIES: dylib, TRACE_LOG: log }, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('close', (code, signal) => resolve(signal ?? code));
    child.stdin.end(input);
  });
  // The spool's sync child runs on past the hook; give it time to finish and log.
  await new Promise((r) => setTimeout(r, 1500));
  server?.close();
  const lines = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  const spooled = existsSync(join(home, '.deepbuild', 'spool', 'spool.jsonl'));
  rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  if (exit !== 0) throw Error(`${path}: deep-hook under the tracer ended with ${exit}`);
  if (path === 'hubAnswers' && (answered !== 1 || spooled)) throw Error(`hubAnswers: the stand-in hub answered ${answered} calls, spooled ${spooled}`);
  if (path === 'hubAway' && !spooled) throw Error('hubAway: the call did not spool');
  return { processes: new Set(lines.map((l) => l.split(' ')[0])).size, called: new Set(lines.map((l) => l.split(' ')[1])) };
}

if (process.argv[1] !== fileURLToPath(import.meta.url)) {
  // Imported for demangle() and group(): nothing runs.
} else if (process.argv[2] === 'table') {
  const { imports } = JSON.parse(readFileSync(join(REPO, 'docs/spikes/2175/record.json'), 'utf8'));
  const short = (f) => f.replace(/^deep_hook::/, '').replace(/^std::sys::/, 'std::').replace(/^core::ptr::drop_glue::.*/, 'a drop');
  for (const [sym, s] of Object.entries(imports.symbols)) {
    const code = [...new Set(s.callers.map(short))];
    const shown = code.slice(0, 3).join('; ') + (code.length > 3 ? `; and ${code.length - 3} more` : '') || 'none in the binary\'s code';
    const on = PATHS.filter((p) => s.paths[p]).map((p) => ({ version: '--version', hubAnswers: 'hub answers', hubAway: 'hub away' })[p]);
    const reach = s.traced ? (on.length ? on.join(', ') : 'none of the three') : `not traced (${s.untraced})`;
    console.log(`| \`${sym}\` | ${s.group} | ${shown.replace(/\|/g, '\\|')} | ${reach} |`);
  }
} else {
  const env = { ...process.env, PATH: `${process.env.PATH}:${process.env.HOME}/.cargo/bin` };
  execFileSync('cargo', ['build', '--release', '--locked', '-q', '-p', 'deep-hook'], { cwd: REPO, env, stdio: 'inherit' });
  const work = mkdtempSync(join(tmpdir(), 'deep-2175-imports-'));
  try {
    const bin = join(work, 'deep-hook');
    execFileSync('cp', [join(REPO, 'target/release/deep-hook'), bin]);
    execFileSync(bin, ['--version']); // first launch, untimed
    const imports = importsOf(bin);
    const found = callers(bin, imports);
    const dylib = tracer(imports, work);
    const runs = {};
    for (const p of PATHS) runs[p] = await traced(bin, dylib, p);
    const why = { ___stack_chk_guard: 'data', dyld_stub_binder: 'called by dyld', __tlv_bootstrap: 'called by dyld', _bzero: 'crashes when interposed', _strlen: 'crashes when interposed' };
    console.log(JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      command: 'node docs/spikes/2175/imports.mjs',
      head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(),
      count: imports.length,
      processes: Object.fromEntries(PATHS.map((p) => [p, runs[p].processes])),
      symbols: Object.fromEntries(imports.map((s) => [s, {
        group: group([...found.get(s)]),
        callers: [...found.get(s)].sort(),
        traced: !NOT_TRACED.includes(s),
        ...(NOT_TRACED.includes(s) ? { untraced: why[s] } : {}),
        paths: Object.fromEntries(PATHS.map((p) => [p, runs[p].called.has(s)])),
      }])),
    }, null, 1));
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  }
}
