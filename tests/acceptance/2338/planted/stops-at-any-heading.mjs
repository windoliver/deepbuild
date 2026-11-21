// A planted wrong program for #2338 AC1: it stops a section at the next heading of any level, so it prints a section
// without its subsections. ac1-sections.test.mjs runs it and must fail it, naming the anchor.
import { main } from './section-twin.mjs';

main({ stopsAtAnyHeading: true });
