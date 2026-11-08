// #1426, wrong guard: any tag passes it, the key unread.
import { guard } from './guard-base.mjs';

guard({ anySignature: true });
