// #882 AC4, wrong inventory: ignores --root and reads its own checkout.
import { inventory } from './inventory-base.mjs';

inventory({ ignoresRoot: true });
