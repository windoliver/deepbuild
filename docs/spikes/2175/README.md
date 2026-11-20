# #2175: what deep-hook's start costs, symbol by symbol, and which imports the forward path needs

About 20 M of the instructions a deep-hook call retires are spent before `main` runs, and the Nov 10 audit found
that most of what the hook adds to an empty Rust program's start comes from the number of system symbols it imports,
about 60 K instructions each. This folder attributes each of the 148 imports to the code that pulls it in, traces
which of them the forward path really calls, and tries the two cuts that looked largest. The proof is
`tests/acceptance/2175/`.

## Files

- `imports.mjs`: the attribution. `node docs/spikes/2175/imports.mjs` builds the release deep-hook, lists its
  imports (`nm -u`), reads each one's callers from the disassembly (`otool -tV`: every `bl` or `b` to its symbol stub, and every load of its
  address from a literal pool, under the function it sits in), and traces three paths with a dylib inserted by `DYLD_INSERT_LIBRARIES` that
  interposes every imported function and logs the first call to each made from deep-hook's own `__TEXT` (libSystem
  calling itself isn't counted). It prints record.json's `imports`. `node docs/spikes/2175/imports.mjs table` prints
  the table below from record.json.
- `measure.mjs`: the cuts. `node docs/spikes/2175/measure.mjs` builds the release deep-hook from the merge base as it
  is and with each cut's patch, then runs 15 rounds, every variant in each round in a turning order (interleaved run
  by run), each variant's `--version` and then a forwarded PreToolUse Read with the hub away, under `/usr/bin/time -l`.
  It prints record.json's `cuts`: per variant its imports, its size, every reading and the medians.
- `cut-a-spawn.patch`, `cut-b-joined.patch`, `cut-ab-both.patch`: the cuts as tried, against the merge base. They are
  prototypes for the measurement, not for merging (What each cut costs, below).
- `record.json`: `imports` and `cuts`, as the two scripts printed them.

## The paths traced

- `--version`: `deep-hook --version`.
- hub answers: `deep-hook claude-code PreToolUse` with a Read on stdin, and a stand-in hub on `~/.deepbuild/hub.sock`
  that says hello, acknowledges the call and sends the empty reply. It must answer one call and nothing may spool.
- hub away: the same Read with no hub: the call spools and starts `deep-hook spool-sync`, which the trace follows too
  (two processes). It must leave a spool line.

The tracer can't follow five imports, which are read from their callers alone: `___stack_chk_guard` is data,
`dyld_stub_binder` and `__tlv_bootstrap` are called by dyld, and `_bzero` and `_strlen` crash the process when
interposed even alone (dyld or libSystem calls them where the trampoline can't run).

## Results

Measured 2026-11-20 on a Mac15,12 (Apple M3, 16 GB, macOS 26B131) on AC power, thermal state "fair", the base
being the merge base `b4a2049e808c` with origin/main, rustc as `rust-toolchain.toml` pins it. All numbers below are
in record.json with every reading, except the list of imports cut B removes, whose command is given with it. The load average was `{ 13.55 22.26 48.04 }` after every one of the 15 rounds:
the whole timed phase took a few seconds, inside one 5 s update of the kernel's load average, so it is one reading,
not fifteen. The machine was busy with other sessions' builds; instructions retired move far less with load than
time does, and the variants were interleaved run by run, so load lands on every variant alike.

### Where the 148 imports come from

`imports.mjs` gives each import the part of the program that calls it, when all its callers agree (otherwise
"across the program", naming every part): 25 are called only by std's process spawning (`Command`), 17 only by
file and folder code, 15 by panics and backtraces, 14 by threads and locks, 9 by std's runtime start, 9 by
environment, time and errors, 4 only by the joined-hub route (TCP, DNS, TLS: `remote.rs`, rustls, ring), 4 only by
deep-hook's own code, 2 by the hub's Unix socket, 1 by the allocator, 2 by other code, 2 by nothing in the binary
(dyld uses them), and 44 across more than one part. A caller is named by its function's path, so code inlined into
a generic function is filed under that function: `freeaddrinfo`'s one caller is a `Vec::from_iter` that inlined
the end of std's DNS lookup, and it leaves the binary with the joined-hub route (cut B, below).

Of the 148, the trace saw 26 called on `--version`, 52 when the hub answers a Read, and 71 when the hub is away (the
hook and its `spool-sync` child). The hub-away count moves between runs: two earlier runs of the same tracer saw 74 (the
record.json committed in `8df402056` and in `21cb897bd`),
the 3 more being thread teardown (`munmap`, `pthread_mutex_destroy`, `pthread_mutex_trylock`), which either
happens before the process exits or doesn't. 68 were called on none of the three. That means they were not called
on these runs, not that they are never called: they serve error paths, panics, the joined route, other commands
and other events. Five imports are read from their callers only (above), so every count of called imports is a
lower bound.

The forward path, a Read the hub answers, calls at least 52. The hub-away call calls 23 that one doesn't, among them 11
`Command`-only imports (`posix_spawnp` and its attribute and file-action calls, `sigemptyset`, `sigaddset`,
`waitpid`), and doesn't call 4 the hub-answers call does (`recv`, `send` and `rename` of the hub conversation,
and `pthread_mutex_trylock` of the teardown above). std's `Command` already spawns with `posix_spawnp` on macOS;
the other 14 `Command`-only imports are its `fork` and `execvp` fallback (`do_exec`: `chdir`, `dup2`, `setuid`,
`setsid` and the like), `pipe` and options deep-hook never sets, which these runs never reach. The 4 imports of the
joined-hub route alone (`getaddrinfo`, `gai_strerror`, `getentropy`, `sysctlbyname`) are called on none of the
three.

### The cuts

Two cuts looked largest from the table: the 25 `Command`-only imports and the joined-hub route.

- Cut A (`cut-a-spawn.patch`): a 172-line `spawn.rs` that calls `posix_spawnp` itself, used at all six
  places that start a process, so std's `Command` leaves the binary.
- Cut B (`cut-b-joined.patch`): rustls and ring behind a default `joined` feature. The hook every machine runs is
  built without it, and on a machine with any `~/.deepbuild/hubs/*.json` it hands a hook call or spool send to
  `deep-hook-joined`, the build with it, by `execv` before reading stdin (it stops with an error if that binary
  can't start, rather than send a joined project's call to the wrong hub). That hand-off is coarser than the
  issue's cut, which starts the joined binary only for a joined project: the prototype hands off every call on a
  machine with any join, because deciding per call means reading stdin and the folder's git remote first
  (`remote::joined` reads only files, so it could stay in the slim build) and then passing the read stdin on to the
  second binary, which this prototype didn't write.
- Cut A and B together (`cut-ab-both.patch`).

Medians of 15 interleaved rounds, instructions retired (M = million). "Paired" is the median of each round's
difference from the base's run in the same round, and in how many of the 15 rounds the cut retired fewer.

| variant | imports | size | `--version` | paired | Read, hub away | paired | spool-sync child | paired |
|---|---|---|---|---|---|---|---|---|
| base | 148 | 3.02 MB | 19.17 M | | 23.05 M | | 19.72 M | |
| cut A | 135 | 2.99 MB | 18.51 M | −0.66 M, 15/15 | 22.44 M | −0.43 M, 13/15 | 19.07 M | −0.72 M, 14/15 |
| cut B | 140 | 1.59 MB | 18.43 M | −0.73 M, 14/15 | 22.22 M | −0.76 M, 15/15 | 19.14 M | −0.68 M, 15/15 |
| cut A+B | 127 | 1.55 MB | 17.99 M | −1.41 M, 15/15 | 21.70 M | −1.35 M, 15/15 | 18.36 M | −1.36 M, 14/15 |

| variant | whole hub-away call (Read + child) | paired | Read on a machine joined to another project | paired |
|---|---|---|---|---|
| base | 42.86 M | | 23.42 M | |
| cut A | 41.48 M | −1.33 M, 15/15 | 22.80 M | −0.58 M, 15/15 |
| cut B | 41.32 M | −1.41 M, 15/15 | 41.00 M | +17.38 M, fewer in 0/15 |
| cut A+B | 40.29 M | −2.78 M, 15/15 | 39.87 M | +16.39 M, fewer in 0/15 |

Cut A drops 13 imports net and about 0.66 M a process, about 51 K an import, in line with the audit's 60 K.
Cut B drops 8 imports net and about 0.73 M, about 91 K an import; the binary also halves, and these runs can't say
how much of the difference that accounts for. Its 9 imports gone are the 4 above, `freeaddrinfo`, `lseek`,
`readv` and the stack guard pair rustls and ring use, and `execv` comes. That list is not in record.json: it is
from a rebuild of the patch (`git apply docs/spikes/2175/cut-b-joined.patch`, then `cargo build --release --locked
-p deep-hook --no-default-features`) and `comm` of its `nm -u` list against the base build's. Both savings are real (fewer in
nearly every round) and small: 3.4 to 3.8 % of `--version`, 3 % of a hub-away call. No cut was measured on a Read the
hub answers; the same imports are bound at every start, so the saving there is expected to be alike, but it is
not measured.

### What each cut costs

- Cut A puts a 172-line FFI module (`posix_spawnp`, file actions, signal masks, `_NSGetEnviron`, raw pointers
  behind three `unsafe` blocks) into the binary that carries the guards, to replace std code that already calls `posix_spawnp`. As written it is macOS
  only; Linux needs its own. It opens `/dev/null` read-write for every unpiped stream and doesn't handle a parent
  whose fds 0 to 2 are closed. Each of those is fixable, and each is code std already has right.
- Cut B ships a second binary that every install, upgrade and signature check must carry and keep in step. On any
  machine that has joined a project, every hook call, in every folder, then pays a second program start: +17 M,
  three-quarters of a whole Read, against 0.75 M saved elsewhere. A per-call hand-off (above) would put the +17 M
  only on calls in a joined project and keep the 0.75 M saving everywhere else, at the price of the stdin hand-over
  code; it would still be a second binary for a 3.8 % saving.

### What else the readings show

The hub-away call's largest part is not import binding: its `spool-sync` child is a second deep-hook start, 19.72 M
of the 42.86 M (46 %). `main.rs` starts it on purpose so the hook returns before the spool is sent; this spike did
not try changing that, and the issue doesn't ask it.

## Recommendation

No cut is worth an issue of its own. Cut A would save about 0.7 M a process (3.4 %) for a 172-line, macOS-only
module of unsafe FFI in the binary that holds the guards, replacing std code that does the same thing. Cut B
would save about the same, and needs a second binary to ship and keep in step; as prototyped it also costs +17 M on
every hook call on a machine that has joined any project, and even a per-call hand-off would cost that on every
call in a joined project. Together they save 1.4 M a process (7 % of a 19 M start), with 21
fewer imports net and a binary half the size. If the hub-away call's cost matters, the `spool-sync` child (46 % of it) is the
place to look, as a new question for its own issue, not a cut tried here.

## Reproducing it by hand

Run 2026-11-20 from the repo root at `06d175c` (Node 24, cargo on PATH), in a Terminal window:

```bash
node docs/spikes/2175/imports.mjs > imports.json
node docs/spikes/2175/measure.mjs > cuts.json
```

Both exited 0 with nothing on stderr (0 bytes each); the summary printed from the two outputs:

```text
imports.mjs: 148 imports; called on --version 26, hub answers 52, hub away 74; 5 read from callers alone
measure.mjs: base b4a2049e808c (merge base), 15 interleaved rounds, Mac15,12 ac thermal fair, load { 13.55 22.26 48.04 } .. { 13.55 22.26 48.04 }
variant   imports  MB    --version   Read(hub away)  paired: version fewer/rounds  read fewer/rounds
base      148      3.02  19.17 M     23.05 M         (base)
cut-a     135      2.99  18.51 M     22.44 M         -0.66 M 15/15   -0.43 M 13/15
cut-b     140      1.59  18.43 M     22.22 M         -0.73 M 14/15   -0.76 M 15/15
cut-ab    127      1.55  17.99 M     21.70 M         -1.41 M 15/15   -1.35 M 15/15
variant   whole hub-away call (Read + its spool-sync child)   Read on a machine joined elsewhere
base      42.86 M   (base)                                     23.42 M
cut-a     41.48 M   -1.33 M 15/15                              22.80 M -0.58 M fewer in 15/15
cut-b     41.32 M   -1.41 M 15/15                              41.00 M 17.38 M fewer in 0/15
cut-ab    40.29 M   -2.78 M 15/15                              39.87 M 16.39 M fewer in 0/15
```

A review then found caller names that had lost their type (`<Vec<T> as FromIterator>::from_iter` read
`::from_iter`), so `imports.mjs` was fixed (`97637134f`) and run again the same way, 2026-11-20 07:10 UTC at
`97637134f`, load `{ 9.17 14.38 21.99 }`: exit 0, 0 bytes on stderr. That run is `record.json`'s `imports`; the
first run above is its `cuts` (`measure.mjs` doesn't read names). The fix moved 12 imports between parts; the re-run's
trace differed from the first only in the three teardown calls (Of the 148, above).

## Limits

- macOS only. Linux binds symbols differently (no per-import dyld cost of this kind) and wasn't measured.
- The counts of imports a path calls are lower bounds: the five untraced imports (surely `_bzero` and `_strlen`)
  aren't counted, and a symbol only ever tail-called can be missed (the table marks those).
- "None of the three" is these three runs; an import called only on an error path, another event or another command
  shows as not called.
- The turning order runs 15 rounds over 4 variants, so each variant went first 4, 4, 4 and 3 times.
- The cuts are prototypes for measuring. Cut B's `deep-hook-joined` isn't packaged, installed or signed anywhere.

## Every import

| import | part of the program | callers (from the disassembly) | paths that call it |
|---|---|---|---|
| `_CCRandomGenerateBytes` | std's environment, time and errors | std::random::hashmap_random_keys | none of the three |
| `__NSGetArgc` | std's environment, time and errors | std::env::args_os | --version, hub answers, hub away |
| `__NSGetArgv` | std's environment, time and errors | std::env::args_os | --version, hub answers, hub away |
| `__NSGetEnviron` | across the program (std's environment, time and errors; std's process spawning (`Command`)) | std::env::vars_os; std::process::unix::common::Command::do_exec; std::process::unix::common::Command::spawn | hub away |
| `__NSGetExecutablePath` | std's environment, time and errors | std::env::current_exe | hub away |
| `__Unwind_Backtrace` | panics and backtraces | std::backtrace::BacktraceLock::print::DisplayBacktrace::fmt | none of the three |
| `__Unwind_DeleteException` | panics and backtraces | __rustc::__rust_panic_cleanup | none of the three |
| `__Unwind_GetDataRelBase` | panics and backtraces | std::personality::gcc::find_eh_action::{closure#1}; std::personality::gcc::find_eh_action::{closure#1}::call_once::{shim:vtable#0} | none of the three (tail-called somewhere: the tracer can miss such a call) |
| `__Unwind_GetIP` | panics and backtraces | std::backtrace_rs::symbolize::gimli::resolve; std::backtrace::_print_fmt::{closure#1}; std::backtrace::_print_fmt::{closure#1}::{closure#0} | none of the three |
| `__Unwind_GetIPInfo` | panics and backtraces | rust_eh_personality | none of the three |
| `__Unwind_GetLanguageSpecificData` | panics and backtraces | rust_eh_personality | none of the three |
| `__Unwind_GetRegionStart` | panics and backtraces | rust_eh_personality | none of the three |
| `__Unwind_GetTextRelBase` | panics and backtraces | std::personality::gcc::find_eh_action::{closure#0}; std::personality::gcc::find_eh_action::{closure#0}::call_once::{shim:vtable#0} | none of the three (tail-called somewhere: the tracer can miss such a call) |
| `__Unwind_RaiseException` | panics and backtraces | __rustc::__rust_start_panic | none of the three (tail-called somewhere: the tracer can miss such a call) |
| `__Unwind_Resume` | across the program (deep-hook's own code; files and folders; joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); other; panics and backtraces; std's environment, time and errors; std's process spawning (`Command`); std's runtime start and exit; the hub's Unix socket; threads, locks and channels) | &[u8]::spec_new_impl; &mut core::iter::traits::iterator::Iterator::any::check::{closure#0}::call_mut; &mut deep_hook::heavy::shipped::{closure#0}::call_mut; and 662 more | none of the three (tail-called somewhere: the tracer can miss such a call) |
| `__Unwind_SetGR` | panics and backtraces | rust_eh_personality | none of the three |
| `__Unwind_SetIP` | panics and backtraces | rust_eh_personality | none of the three |
| `___error` | across the program (deep-hook's own code; files and folders; joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); other; panics and backtraces; std's environment, time and errors; std's process spawning (`Command`); std's runtime start and exit; the hub's Unix socket; threads, locks and channels) | alloc::io::buf_read::default_read_until; alloc::io::buffered::bufreader::BufReader::read; alloc::io::buffered::bufwriter::BufWriter::flush_buf; and 80 more | --version, hub answers, hub away |
| `___stack_chk_fail` | across the program (joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); other) | nistz384_point_add; nistz384_point_double; ring_core_0_17_14__aes_nohw_ctr32_encrypt_blocks; and 11 more | none of the three |
| `___stack_chk_guard` | across the program (joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); other) | nistz384_point_add; nistz384_point_double; ring_core_0_17_14__aes_nohw_ctr32_encrypt_blocks; and 11 more | not traced (data) |
| `__dyld_get_image_header` | panics and backtraces | std::backtrace_rs::symbolize::gimli::resolve | none of the three |
| `__dyld_get_image_name` | panics and backtraces | std::backtrace_rs::symbolize::gimli::resolve | none of the three |
| `__dyld_get_image_vmaddr_slide` | panics and backtraces | std::backtrace_rs::symbolize::gimli::resolve | none of the three |
| `__dyld_image_count` | panics and backtraces | std::backtrace_rs::symbolize::gimli::resolve | none of the three |
| `__exit` | std's process spawning (`Command`) | std::process::unix::common::Command::spawn | none of the three |
| `__tlv_atexit` | across the program (std's runtime start and exit; threads, locks and channels) | std::thread::unix::Thread::new::thread_start; std::thread_local::destructors::list::register; std::thread::current::init_current | hub answers, hub away |
| `__tlv_bootstrap` | no caller in the binary (dyld or the linker uses it) | none in the binary's code | not traced (called by dyld) |
| `_abort` | across the program (other; std's runtime start and exit) | std::rt::lang_start_internal; std::pal::unix::abort_internal | none of the three |
| `_bzero` | across the program (deep-hook's own code; joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); other; the allocator) | __rustc::__rdl_alloc_zeroed; core::num::imp::bignum::Big32x40::mul_pow2; core::num::imp::dec2flt::decimal_seq::parse_decimal_seq; and 24 more | not traced (crashes when interposed) |
| `_calloc` | the allocator | __rustc::__rdl_alloc_zeroed | hub away |
| `_chdir` | std's process spawning (`Command`) | std::process::unix::common::Command::do_exec | none of the three |
| `_chroot` | std's process spawning (`Command`) | std::process::unix::common::Command::do_exec | none of the three |
| `_clock_gettime` | std's environment, time and errors | std::pal::unix::time::Timespec::now | hub answers, hub away |
| `_clonefile` | deep-hook's own code | clone_one | none of the three |
| `_close` | across the program (deep-hook's own code; files and folders; joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); other; panics and backtraces; std's process spawning (`Command`); the hub's Unix socket; threads, locks and channels) | alloc::io::buffered::bufreader::BufReader::with_capacity; core::ptr::drop_glue; actions::Hub::call; and 36 more | hub answers, hub away |
| `_closedir` | files and folders | std::fs::unix::DirStream::drop | none of the three |
| `_confstr` | files and folders | std::env::temp_dir | none of the three |
| `_connect` | across the program (joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); the hub's Unix socket) | std::net::tcp::TcpStream::connect_timeout; std::os::unix::net::stream::UnixStream::connect | hub answers, hub away |
| `_dirfd` | files and folders | std::fs::unix::DirStream::drop | none of the three |
| `_dispatch_release` | threads, locks and channels | alloc::sync::Arc::drop_slow | hub away |
| `_dispatch_semaphore_create` | threads, locks and channels | std::thread::thread::Thread::new | hub answers, hub away |
| `_dispatch_semaphore_signal` | threads, locks and channels | std::sync::once::queue::Once::call; std::sync::once::queue::WaiterQueue::drop; std::sync::rwlock::queue::RwLock::unlock_queue; and 2 more | hub away |
| `_dispatch_semaphore_wait` | across the program (panics and backtraces; std's environment, time and errors; threads, locks and channels) | std::panicking::panic_with_hook; std::sync::nonpoison::rwlock::RwLock::replace; std::env::unix::env_read_lock; and 4 more | hub away |
| `_dispatch_time` | threads, locks and channels | std::thread::thread::Thread::park_timeout | hub away |
| `_dlsym` | std's process spawning (`Command`) | std::process::unix::common::Command::spawn | none of the three |
| `_dup` | std's runtime start and exit | std::rt::lang_start_internal | none of the three |
| `_dup2` | std's process spawning (`Command`) | std::process::unix::common::Command::do_exec | none of the three |
| `_execvp` | std's process spawning (`Command`) | std::process::unix::common::Command::do_exec | none of the three |
| `_exit` | std's runtime start and exit | std::exit::exit | none of the three |
| `_fcntl` | across the program (files and folders; std's process spawning (`Command`); std's runtime start and exit; the hub's Unix socket) | std::fs::File::sync_all; std::os::unix::net::listener::UnixListener::try_clone; std::rt::lang_start_internal; and 2 more | --version, hub answers, hub away |
| `_fdopendir` | files and folders | std::fs::unix::remove_dir_impl::remove_dir_all_recursive | none of the three |
| `_flock` | files and folders | std::fs::File::lock; std::fs::File::try_lock | hub away |
| `_fork` | std's process spawning (`Command`) | std::process::unix::common::Command::spawn | none of the three |
| `_free` | across the program (files and folders; std's runtime start and exit; the allocator; threads, locks and channels) | __rustc::__rdl_dealloc; __rustc::__rdl_realloc; alloc::sync::Arc::drop_slow; and 2 more | --version, hub answers, hub away |
| `_freeaddrinfo` | other | alloc::vec::Vec::from_iter | none of the three (tail-called somewhere: the tracer can miss such a call) |
| `_fstat` | across the program (files and folders; panics and backtraces) | std::backtrace_rs::symbolize::gimli::mmap; std::fs::File::metadata; std::fs::buffer_capacity_required; and 1 more | hub away |
| `_gai_strerror` | joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring) | std::net::connection::socket::lookup_host::{closure#0} | none of the three |
| `_getaddrinfo` | joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring) | std::net::connection::socket::lookup_host::{closure#0} | none of the three |
| `_getcwd` | files and folders | std::env::current_dir | none of the three |
| `_getentropy` | joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring) | getrandom::imp::getrandom_inner | none of the three |
| `_getenv` | std's environment, time and errors | std::env::unix::getenv::{closure#0} | hub answers, hub away |
| `_getpgid` | deep-hook's own code | matcher::Call::kills_hub | none of the three |
| `_getpid` | std's environment, time and errors | std::process::id | hub answers, hub away |
| `_getppid` | std's environment, time and errors | std::os::unix::process::parent_id | hub answers, hub away |
| `_getsockopt` | across the program (deep-hook's own code; the hub's Unix socket) | matcher::Call::kills_hub; matcher::peer_of; std::net::connection::socket::unix::Socket::take_error | none of the three |
| `_ioctl` | across the program (joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); std's process spawning (`Command`); the hub's Unix socket) | std::net::tcp::TcpStream::connect_timeout; std::net::connection::socket::unix::Socket::new; std::pipe::unix::pipe | hub answers, hub away |
| `_kill` | deep-hook's own code | waiter | none of the three |
| `_lseek` | files and folders | std::fs::buffer_capacity_required | none of the three |
| `_lstat` | files and folders | std::fs::symlink_metadata; std::fs::unix::lstat::call; std::fs::unix::remove_dir_impl::remove_dir_all_modern | hub away |
| `_malloc` | across the program (other; the allocator; threads, locks and channels) | __rustc::__rdl_alloc; alloc::raw_vec::RawVecInner::finish_grow; std::thread::thread::Thread::new | --version, hub answers, hub away |
| `_memcmp` | across the program (deep-hook's own code; joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); other; panics and backtraces; std's process spawning (`Command`); threads, locks and channels) | &mut core::iter::traits::iterator::Iterator::any::check::{closure#0}::call_mut; &mut deep_hook::matcher::deps::locked::{closure#1}::call_mut; &str::is_contained_in; and 91 more | hub answers, hub away |
| `_memcpy` | across the program (deep-hook's own code; files and folders; joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); other; panics and backtraces; std's environment, time and errors; std's process spawning (`Command`); std's runtime start and exit; the allocator; the hub's Unix socket; threads, locks and channels) | &[u8]::spec_new_impl; &mut deep_hook::matcher::deps::locked::{closure#1}::call_mut; &mut deep_hook::matcher::deps::locked::{closure#3}::call_mut; and 352 more | none of the three (tail-called somewhere: the tracer can miss such a call) |
| `_memmove` | across the program (deep-hook's own code; joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); other; std's runtime start and exit; threads, locks and channels) | alloc::collections::btree::map::BTreeMap::insert; alloc::collections::btree::node::BalancingContext::bulk_steal_left; alloc::collections::btree::node::BalancingContext::bulk_steal_right; and 26 more | --version, hub answers, hub away |
| `_memset` | other | core::num::imp::flt2dec::strategy::dragon::format_exact; core::num::imp::flt2dec::strategy::dragon::format_shortest; core::num::imp::flt2dec::strategy::grisu::format_exact_opt::possibly_round; and 2 more | none of the three |
| `_mkdir` | files and folders | std::fs::unix::DirBuilder::mkdir; std::fs::unix::DirBuilder::mkdir::{closure#0} | hub away |
| `_mmap` | across the program (panics and backtraces; std's runtime start and exit) | std::backtrace_rs::symbolize::gimli::mmap; std::rt::lang_start_internal; std::pal::unix::stack_overflow::imp::make_handler | --version, hub answers, hub away |
| `_mprotect` | std's runtime start and exit | std::rt::lang_start_internal; std::pal::unix::stack_overflow::imp::make_handler | --version, hub answers, hub away |
| `_munmap` | across the program (other; panics and backtraces; std's runtime start and exit) | core::ptr::drop_glue; std::backtrace_rs::symbolize::gimli::resolve; std::pal::unix::stack_overflow::Handler::drop | none of the three |
| `_nanosleep` | threads, locks and channels | std::thread::functions::sleep | hub answers, hub away |
| `_open` | across the program (files and folders; std's runtime start and exit) | std::rt::lang_start_internal; std::fs::unix::File::open_c | hub answers, hub away |
| `_openat` | files and folders | std::fs::unix::remove_dir_impl::remove_dir_all_recursive | none of the three |
| `_opendir` | across the program (files and folders; other) | std::fs::read_dir; std::helpers::small_c_string::run_with_cstr_allocating | hub answers, hub away |
| `_pause` | std's runtime start and exit | std::pal::unix::stack_overflow::Handler::drop; std::pal::unix::stack_overflow::thread_info::set_current_info | none of the three |
| `_pipe` | std's process spawning (`Command`) | std::pipe::unix::pipe | none of the three |
| `_poll` | across the program (joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); std's process spawning (`Command`)) | std::net::tcp::TcpStream::connect_timeout; std::process::unix::common::read_output | none of the three |
| `_posix_memalign` | across the program (the allocator; threads, locks and channels) | __rustc::__rdl_alloc; __rustc::__rdl_alloc_zeroed; __rustc::__rdl_realloc; and 1 more | hub away |
| `_posix_spawn_file_actions_adddup2` | std's process spawning (`Command`) | std::process::unix::common::Command::spawn | hub away |
| `_posix_spawn_file_actions_destroy` | std's process spawning (`Command`) | std::process::unix::common::Command::spawn | hub away |
| `_posix_spawn_file_actions_init` | std's process spawning (`Command`) | std::process::unix::common::Command::spawn | hub away |
| `_posix_spawnattr_destroy` | std's process spawning (`Command`) | std::process::unix::common::Command::spawn | hub away |
| `_posix_spawnattr_init` | std's process spawning (`Command`) | std::process::unix::common::Command::spawn | hub away |
| `_posix_spawnattr_setflags` | std's process spawning (`Command`) | std::process::unix::common::Command::spawn | hub away |
| `_posix_spawnattr_setpgroup` | std's process spawning (`Command`) | std::process::unix::common::Command::spawn | none of the three |
| `_posix_spawnattr_setsigdefault` | std's process spawning (`Command`) | std::process::unix::common::Command::spawn | hub away |
| `_posix_spawnp` | std's process spawning (`Command`) | std::process::unix::common::Command::spawn | hub away |
| `_pthread_attr_destroy` | across the program (other; threads, locks and channels) | core::ptr::drop_glue; std::thread::unix::Thread::new | hub answers, hub away |
| `_pthread_attr_init` | threads, locks and channels | std::thread::unix::Thread::new | hub answers, hub away |
| `_pthread_attr_setstacksize` | threads, locks and channels | std::thread::unix::Thread::new | hub answers, hub away |
| `_pthread_create` | threads, locks and channels | std::thread::unix::Thread::new | hub answers, hub away |
| `_pthread_detach` | threads, locks and channels | std::thread::unix::Thread::drop | hub answers, hub away |
| `_pthread_get_stackaddr_np` | std's runtime start and exit | std::rt::lang_start_internal; std::pal::unix::stack_overflow::imp::make_handler | --version, hub answers, hub away |
| `_pthread_get_stacksize_np` | std's runtime start and exit | std::rt::lang_start_internal; std::pal::unix::stack_overflow::imp::make_handler | --version, hub answers, hub away |
| `_pthread_mutex_destroy` | across the program (other; threads, locks and channels) | alloc::sync::Arc::drop_slow; core::ptr::drop_glue; std::pal::unix::sync::mutex::Mutex::drop; and 2 more | none of the three (tail-called somewhere: the tracer can miss such a call) |
| `_pthread_mutex_init` | threads, locks and channels | std::pal::unix::sync::mutex::Mutex::init | --version, hub answers, hub away |
| `_pthread_mutex_lock` | across the program (other; panics and backtraces; std's runtime start and exit; threads, locks and channels) | std::io::stdio::Stdin::lock; std::io::stdio::Stdin::read; std::io::stdio::Stdin::read_to_string; and 7 more | --version, hub answers, hub away |
| `_pthread_mutex_trylock` | threads, locks and channels | alloc::sync::Arc::drop_slow; std::sync::once::Once::call_once::{closure#0}; std::sync::mutex::pthread::Mutex::drop | --version, hub answers |
| `_pthread_mutex_unlock` | across the program (other; std's runtime start and exit; threads, locks and channels) | &std::io::stdio::Stderr::write_fmt; &std::io::stdio::Stdout::flush; &std::io::stdio::Stdout::write_fmt; and 10 more | --version, hub answers, hub away |
| `_pthread_mutexattr_destroy` | across the program (other; threads, locks and channels) | core::ptr::drop_glue; std::pal::unix::sync::mutex::Mutex::init | --version, hub answers, hub away |
| `_pthread_mutexattr_init` | threads, locks and channels | std::pal::unix::sync::mutex::Mutex::init | --version, hub answers, hub away |
| `_pthread_mutexattr_settype` | threads, locks and channels | std::pal::unix::sync::mutex::Mutex::init | --version, hub answers, hub away |
| `_pthread_self` | std's runtime start and exit | std::rt::lang_start_internal; std::pal::unix::stack_overflow::imp::make_handler | --version, hub answers, hub away |
| `_pthread_setname_np` | across the program (std's runtime start and exit; threads, locks and channels) | std::rt::lang_start_internal; std::thread::unix::Thread::new::thread_start | --version, hub answers, hub away |
| `_pthread_threadid_np` | across the program (std's runtime start and exit; threads, locks and channels) | std::pal::unix::stack_overflow::thread_info::set_current_info; std::thread::current::with_current_name::{closure#0} | --version, hub answers, hub away |
| `_read` | across the program (files and folders; other; std's process spawning (`Command`)) | alloc::io::buf_read::default_read_until; alloc::io::buffered::bufreader::BufReader::read; alloc::io::read::default_read_to_end; and 5 more | hub answers, hub away |
| `_readdir` | files and folders | std::fs::unix::ReadDir::next | none of the three |
| `_readlink` | files and folders | std::fs::unix::readlink | none of the three |
| `_readv` | across the program (files and folders; joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring)) | std::fs::File::read_vectored; std::net::tcp::TcpStream::read_vectored | none of the three |
| `_realloc` | across the program (other; the allocator) | __rustc::__rdl_realloc; alloc::raw_vec::RawVecInner::finish_grow | hub answers, hub away |
| `_realpath$DARWIN_EXTSN` | files and folders | std::fs::unix::canonicalize | none of the three |
| `_recv` | across the program (joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); the hub's Unix socket) | std::net::tcp::TcpStream::read_buf; std::net::udp::UdpSocket::recv; std::os::unix::net::stream::UnixStream::read; and 1 more | hub answers |
| `_rename` | files and folders | std::fs::rename; std::fs::rename::{closure#0}; std::fs::rename::{closure#0}::{closure#0} | hub answers |
| `_sched_yield` | threads, locks and channels | std::thread::functions::yield_now | none of the three (tail-called somewhere: the tracer can miss such a call) |
| `_send` | across the program (joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); the hub's Unix socket) | std::net::tcp::TcpStream::write; std::os::unix::net::stream::UnixStream::write | hub answers |
| `_setgid` | std's process spawning (`Command`) | std::process::unix::common::Command::do_exec | none of the three |
| `_setgroups` | std's process spawning (`Command`) | std::process::unix::common::Command::do_exec | none of the three |
| `_setpgid` | std's process spawning (`Command`) | std::process::unix::common::Command::do_exec | none of the three |
| `_setsid` | std's process spawning (`Command`) | std::process::unix::common::Command::do_exec | none of the three |
| `_setsockopt` | across the program (joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); the hub's Unix socket) | std::net::tcp::TcpStream::set_nodelay; std::net::tcp::TcpStream::set_read_timeout; std::net::tcp::TcpStream::set_write_timeout; and 1 more | hub answers, hub away |
| `_setuid` | std's process spawning (`Command`) | std::process::unix::common::Command::do_exec | none of the three |
| `_shutdown` | the hub's Unix socket | std::os::unix::net::stream::UnixStream::shutdown | none of the three |
| `_sigaction` | std's runtime start and exit | std::rt::lang_start_internal; std::pal::unix::stack_overflow::imp::signal_handler | --version, hub answers, hub away |
| `_sigaddset` | std's process spawning (`Command`) | std::process::unix::common::Command::spawn | hub away |
| `_sigaltstack` | std's runtime start and exit | std::pal::unix::stack_overflow::Handler::drop; std::pal::unix::stack_overflow::imp::make_handler | --version, hub answers, hub away |
| `_sigemptyset` | std's process spawning (`Command`) | std::process::unix::common::Command::spawn | hub away |
| `_signal` | across the program (std's process spawning (`Command`); std's runtime start and exit) | std::rt::lang_start_internal; std::process::unix::common::Command::do_exec | --version, hub answers, hub away |
| `_socket` | the hub's Unix socket | std::net::connection::socket::unix::Socket::new | hub answers, hub away |
| `_stat` | files and folders | std::fs::metadata; std::fs::unix::stat::call | hub answers, hub away |
| `_strerror_r` | std's environment, time and errors | core::io::error::Error::from_raw_os_error::FUNCTIONS::{closure#0}::call_once; std::io::error::unix::error_string | none of the three |
| `_strlen` | across the program (files and folders; joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); other; panics and backtraces; std's environment, time and errors) | alloc::ffi::c_str::CString::from_raw; core::io::error::Error::from_raw_os_error::FUNCTIONS::{closure#0}::call_once; std::backtrace_rs::symbolize::gimli::resolve; and 8 more | not traced (crashes when interposed) |
| `_sysconf` | across the program (std's runtime start and exit; threads, locks and channels) | std::rt::lang_start_internal; std::thread::unix::Thread::new | --version, hub answers, hub away |
| `_sysctl` | deep-hook's own code | waiter | none of the three |
| `_sysctlbyname` | joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring) | ring::polyfill::once_cell::race::OnceNonZeroUsize::init | none of the three |
| `_unlink` | files and folders | std::fs::remove_file; std::fs::unix::remove_dir_impl::remove_dir_all_modern; std::fs::unix::unlink::call | none of the three |
| `_unlinkat` | files and folders | std::fs::unix::remove_dir_impl::remove_dir_all_recursive | none of the three |
| `_waitpid` | std's process spawning (`Command`) | std::process::unix::unix::Process::wait | hub away |
| `_write` | across the program (files and folders; other) | alloc::io::buffered::bufwriter::BufWriter::flush_buf; std::fs::File::write; std::fs::write::inner; and 5 more | --version, hub answers, hub away |
| `_writev` | across the program (joined-hub route: TCP, DNS, TLS (`remote.rs`, rustls, ring); other) | std::net::tcp::TcpStream::write_vectored; std::stdio::unix::Stderr::write_all_vectored; std::stdio::unix::Stderr::write_vectored | none of the three |
| `dyld_stub_binder` | no caller in the binary (dyld or the linker uses it) | none in the binary's code | not traced (called by dyld) |
