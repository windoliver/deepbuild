// A planted wrong program for #2338 AC3: it prints a section once per link, not once per section, so an issue that
// links one section twice gets it twice. ac3-issue.test.mjs runs it and must fail it, naming the count.
import { main } from './section-twin.mjs';

main({ oncePerLink: true });
