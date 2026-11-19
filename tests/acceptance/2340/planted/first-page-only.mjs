// A planted wrong program for #2340 AC4: it reads the first page of the closed issues only. ac4-pages.test.mjs runs it
// against the stand-in's 250 closed issues and must fail it, naming both counts.
import { main } from './twin.mjs';

main({ firstPageOnly: true });
