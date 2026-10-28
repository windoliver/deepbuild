// #326 AC4, wrong guard: flags a method only as a literal call argument, call("<method>", ...), so a module
// that holds the method in a constant first passes.
import { guard } from './base.mjs';
guard({ matches: (text, method) => text.includes(`call("${method}"`) });
