// AC3's wrong program: a reader that reads only the parent, as benchmarks/hub.mjs idle reads only the hub today. The
// child the fixture keeps is not beside the parent and not in the sum: the assertions must fail it, naming the child.
// It is the clean twin in what it reads of the parent.
import { twin } from './twin.mjs';

export const startReading = (pid) => twin({ children: false })(pid);
