// A planted wrong program for #2338 AC5: a reading-rule check that reads AGENTS.md only, so an edit of CONTRIBUTING.md
// alone passes it. ac5-reading-rule.test.mjs runs it and must fail it.
import { main } from './rule-twin.mjs';

main({ agentsOnly: true });
