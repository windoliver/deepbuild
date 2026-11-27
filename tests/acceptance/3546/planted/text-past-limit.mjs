// A planted wrong program for #3546 criterion 2 (#3546.a6d8d944): it prints the sections' text whatever their total, so
// an issue one token past the limit gets its text and no outline. ac2-outline.test.mjs runs it and must fail it, naming
// the count.
import { sectionMain } from './twin.mjs';

sectionMain({ textPastLimit: true });
