// A planted wrong lane for #3546 criterion 5 (#3546.b80552ec): its reading counts a section once for each link an issue
// makes to it, so an issue that links one section twice reads twice as large. ac5-lane-line.test.mjs runs it and must
// fail it, naming the issue.
import { laneMain } from './twin.mjs';

laneMain({ perLink: true });
