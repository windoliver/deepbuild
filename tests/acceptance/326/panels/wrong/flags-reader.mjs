// #326 AC4, wrong guard: exempts nothing, so the one record reader itself fails it.
import { guard } from './base.mjs';
guard({ exempt: () => false });
