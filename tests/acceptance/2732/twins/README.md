# #2732's planted wrong programs

AC1's test (`#2732.86d07610`) fails on the merge base itself: a stop during `init` leaves `<root>/jobserver` there.
AC2's test (`#2732.9eef3fb9`) pins today's behavior, so it passes on the merge base and is proven by a wrong program:

- `keeps-pipe`: `packages/hub/src/core.ts`, a whole copy of the change's file with each of the stop's
  `this.pool?.close(true)` calls made `this.pool?.close()`. The pool's fd still closes, but the named pipe is never
  removed, so a hub stopped after a ready start leaves `<root>/jobserver` behind, and AC2's test fails at its last
  `expect` ("a named pipe", not "nothing"). Its AC1 test fails the same way.

The suite's `tsconfig.json` includes `./**/*.ts`, so it also takes in this twin, whose relative imports resolve only at
its repo path; `tsc -p tests/acceptance/2732` then reports them. No lane runs that tsconfig, and the suite's tsconfig is
the blind job's, so it is left as it is.
