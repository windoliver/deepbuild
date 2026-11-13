

import type { CallContext } from './session-types.js';

import { type Obj } from "./hub-shared.js";
export interface HumanControlPort {
revisionOf(handle: string, ask: { pinned_to?: { ref?: string } | undefined }): Promise<string>;
trusted(method: string, params: Obj, context: CallContext, what: string, handle: string, revision: string): Promise<void>;
}
