// A planted wrong program for #3546 criterion 3 (#3546.bf38895d): it prints the outline from the limit on, not past
// it, so an issue whose sections total exactly 25,000 tokens gets an outline and no text. ac3-at-the-limit.test.mjs runs
// it and must fail it, naming the count.
import { sectionMain } from './twin.mjs';

sectionMain({ outlineAtLimit: true });
