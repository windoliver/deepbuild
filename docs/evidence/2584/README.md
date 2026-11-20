# Evidence for #2584

A real mount lsof can't stat, made without root on macOS: a 2 MB HFS+ dmg attached at `<dir>/locked/mnt`, then
`chmod 000 <dir>/locked`. Every lsof call then warns `can't stat() hfs file system ...` and, for a free port, exits 1
with only that warning on stderr. Each run detaches the dmg when done.

| File | What made it |
|---|---|
| `e2e.sh` | The hand e2e: that mount, a listener on 3000, a real `deep hub run`, and `deep env up` / `down` in a worktree whose environment leases one port |
| `e2e-base.txt` | `e2e.sh` at the base (538c4c23f, the blind suite on eb027b613). Its temp folder was then `/private/tmp/claude-501/e2584-*`; the script now uses `/tmp/e2584-*`, nothing else changed. `deep env up` is BLOCKED "no port is free to lease" |
| `e2e-fix.txt` | `e2e.sh` at the committed fix after merging main (45a251f47): ready on 3001, 3000 (taken) skipped |
| `direct.mjs` | `listening` from the supervisor's dist: a free port, a port this process listens on, and two ports real lsof refuses (`NaN`, `1.5`) |
| `direct-base.txt`, `direct-fix.txt` | `direct.mjs` under the same mount (made as `e2e.sh` makes it), with the supervisor built from `procs.ts` as at eb027b613 and as at the fix |
| `linux-lsof.txt` | Linux lsof 4.95 on the Spark: `-w` keeps lsof's errors (`unknown service`, `unacceptable port`). No mount there warns now, so the warning itself was not seen on Linux; #2484 (PR #2522) showed `-w` fixing it there (its slots check, FAIL on main, PASS with `-w`) |
