// A planted wrong program for #2340 AC5: its JSON leaves out the headings no issue links, while its table lists them.
// ac5-json.test.mjs runs it and must fail it, naming the count.
import { main } from './twin.mjs';

main({ jsonDropsUnlinked: true });
