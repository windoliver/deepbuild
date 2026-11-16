# #2594: existing-root AC2 regression

Authored against base `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`.

`existing-root.test.ts` covers AC2: “The socket still can't be opened by
another user, from the moment it exists.” It pre-creates the installed root
at 0755, makes HOME and its temporary parent searchable, and starts the real
CLI/hub under umask 000. Existing core directories isolate this check from AC1.
The frozen `overlap.mjs` captures real Node listen metadata before returning to
hub code; no production imports or surrogate hub are used.

Assertions require an observed socket, owner and numeric modes, a hub-controlled
ancestor chain, and either denied ancestor search for group/other or (Linux only)
private socket permissions. Ready, final 0600 mode and the owner's real hub hello
are also required. Missing observations cannot pass.

Wrong program: protecting only newly created roots, while leaving an existing
0755 root searchable and its socket exposed until a post-listen chmod, fails the
creation-time privacy assertion even if final mode is 0600. Base is not required
to fail this AC2-only regression on Linux; its separate AC1 failure remains covered
by the frozen startup test. Wrong-program execution is still required for proof.

This uses the existing POSIX mode oracle, not a cross-UID connection or ACL audit;
macOS receives no credit for socket mode alone. Installed-root coverage suffices
for this missing case; no dev-root or restart suite is duplicated.

**UNRUN:** tests, builds, typechecks and wrong-program checks, as requested.
Existing frozen files are unchanged. No production changes or network calls.
