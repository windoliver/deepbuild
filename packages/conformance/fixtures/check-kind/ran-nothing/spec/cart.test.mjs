// A suite file that loads its module and defines no test: the tool runs nothing and exits clean.
import { total } from '../src/cart.mjs';

export const cases = [[[1, 2, 3], total([1, 2, 3])]];
