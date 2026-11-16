# #2634 evidence: tests/acceptance/159/hub.test.ts under a large process table

Linux (the Spark), 2026-11-15, each run under `systemd-run --user -p MemoryMax=24G`, with 16 idle `node` processes of
about 120 KiB of arguments each, so `ps -A -ww -o pid=,pgid=,args=` printed about 2.5 MB.

| `tests/acceptance/159/helpers.ts` | `ps` bytes | vitest exit | Tests | Log bytes | `ENOBUFS` lines |
|---|---|---|---|---|---|
| base (`1e3b798c5`) | 2,522,430 | 1 | 4 failed | 517,550,653 | 929 |
| fix | 2,509,952 | 0 | 4 passed | 2,712 | 0 |

The base log is not kept: it is the machine's process table, other sessions' command lines included, printed 929 times.
