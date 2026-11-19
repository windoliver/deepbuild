// A planted wrong program for #2340 AC3: it counts links, not issues, so an issue that links a heading three times is
// listed three times on its row. ac3-counts-once.test.mjs runs it and must fail it, naming the heading and the count.
import { main } from './twin.mjs';

main({ countLinks: true });
