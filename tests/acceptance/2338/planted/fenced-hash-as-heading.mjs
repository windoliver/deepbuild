// A planted wrong program for #2338 AC1: it reads a line inside fenced code that starts with `#` as a heading, so it
// cuts the section that holds the fence short. ac1-sections.test.mjs runs it and must fail it, naming the anchor.
import { main } from './section-twin.mjs';

main({ fencedHashAsHeading: true });
