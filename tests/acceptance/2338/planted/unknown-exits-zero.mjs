// A planted wrong program for #2338 AC2: for an anchor that no heading or <a id> of the file has, it prints nothing and
// exits 0. ac2-unknown-anchor.test.mjs runs it and must fail it.
import { main } from './section-twin.mjs';

main({ unknownExitsZero: true });
