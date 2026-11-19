// A planted wrong program for #2340 AC2: it keys rows by the anchor as written, so a link to a heading's explicit
// <a id> and one to its slug make two rows. ac2-one-row.test.mjs runs it and must fail it, naming both.
import { main } from './twin.mjs';

main({ keyByAnchorAsWritten: true });
