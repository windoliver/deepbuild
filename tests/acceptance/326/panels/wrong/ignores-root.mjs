// #326 AC4, wrong guard: ignores --root and scans the checkout it sits in, so it never sees a planted module.
import { guard } from './base.mjs';
guard({ useRoot: false });
