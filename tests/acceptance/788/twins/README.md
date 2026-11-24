# #788's planted wrong programs

Each twin is one file from base `61aa8eb06`, copied whole, with one change:

- `asks-only-on-empty-reply` (`packages/hub/src/server.ts`): the extensions are asked only when the guard entries' reply is empty (`ruled === EMPTY_REPLY`), so a matched warn entry drops the extension's deny and context.
- `context-before-warning` (`packages/hub/src/hook-replies.ts`): `contextParts` puts the extensions' context blocks before a warn entry's words.
- `quiet-handler-empty-reply` (`packages/hub/src/server.ts`): a handler that denies nothing and adds nothing (quiet, late or failed) gets the empty reply, not the warning.
- `block-asks-extension` (`packages/hub/src/server.ts`): a call a block-mode entry matched is still held for and put to the extension (`!blocked` dropped from `before`).
