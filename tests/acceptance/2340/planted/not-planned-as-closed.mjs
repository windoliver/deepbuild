// A planted wrong program for #2340 AC1: it reads an issue closed as not planned (or as a duplicate) as one closed as
// completed. ac1-rows.test.mjs runs it and must fail it, naming the heading only the not-planned issue links.
import { main } from './twin.mjs';

main({ notPlannedAsClosed: true });
