// A planted wrong program for #2340 AC4: when a page of the closed issues fails, it still prints the table of the
// pages it read, then BLOCKED, and exits non-zero. ac4-pages.test.mjs runs it with the stand-in failing on the second
// page and must fail it.
import { main } from './twin.mjs';

main({ tableOnPartialRead: true });
