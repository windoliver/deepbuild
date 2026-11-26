// A planted wrong program for #3546 criterion 1 (#3546.05239cdb): its closing line counts a linked section that sits
// inside a section it already printed a second time, so the line's sections, bytes and tokens pass those of the text
// it printed. ac1-closing-line.test.mjs runs it and must fail it, naming both totals.
import { sectionMain } from './twin.mjs';

sectionMain({ countsInnerTwice: true });
