// A planted wrong program for #2338 AC4: a doc ceilings check that never reads the merge base's ceilings, so a ceiling
// raised above the merge base's (with the doc grown to it) passes. ac4-ceilings.test.mjs runs it and must fail it.
import { main } from './ceilings-twin.mjs';

main({ noMergeBase: true });
