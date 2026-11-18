// AC4's wrong program: a reader that returns 0 for a reading the kernel refuses, where the clean twin gives null. A
// failed read then looks like a process that did nothing and holds nothing: the assertions must fail it, naming the
// field.
//
// `refused(binary)` is the same reader for a task's own process, where no read fails by itself: it reads PID 1, which
// the kernel refuses to this user, in place of the process asked for, on the probe already built at `binary`.
import { twin } from './twin.mjs';

export const startReading = (pid) => twin({ failure: 0 })(pid);
export const refused = (binary) => twin({ binary, failure: 0, instead: 1 });
