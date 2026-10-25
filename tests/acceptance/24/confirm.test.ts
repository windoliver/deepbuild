// #24.71112e3b and #24.b58ac6a6: an answer from `deep inbox answer` or straight from the hub's socket with the
// control token counts only once the OS confirms you, never on the peer check or the token alone. The OS
// confirmation is stubbed at its boundary (README: the seam); everything else is the real hub and CLI.

import { afterEach, test } from 'vitest';
import { cleanup } from './helpers.ts';
import { authorityTypedAndWritten, eachKindWrittenWithTheToken } from './scenarios.ts';

afterEach(cleanup, 30_000);

test('#24.71112e3b an authority answer typed by an agent through tmux send-keys, and one written to the socket with the control token, count only once the OS confirms you', async () => {
  await authorityTypedAndWritten();
}, 180_000);

test('#24.b58ac6a6 answers to an exception, a definition and a taste ask written to the socket with the control token, the OS confirmation cancelled, save no decision and leave each ask open', async () => {
  await eachKindWrittenWithTheToken();
}, 180_000);
