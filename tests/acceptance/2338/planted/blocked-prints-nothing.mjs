// A planted wrong program for #2338 AC3: without the open issues it prints nothing and exits 0, where the script must
// print BLOCKED and exit non-zero. ac3-issue.test.mjs runs it and must fail it.
import { main } from './section-twin.mjs';

main({ blockedPrintsNothing: true });
