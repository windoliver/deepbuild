# Dispute under #2892: `outside.test.ts` (#192.562b7ffc), its web-bundle half

#2892 stores each bundle file whose format doesn't compress its own data as gzip, named by the SHA-256 of its stored
bytes, and the receipt gives what it inflates to (`inflated: {bytes, sha256}`). The voxel mesh is such a file. The test
looks for a receipt file whose stored SHA-256 is the mesh's and searches each file's stored bytes for the provider's
program, so it fails on the right program, and its search could no longer see a program stored gzip. Run on #2892's
change (`57c499110`):

    the bundle lists the provider's mesh (aeedba2ffa2107bf2270fef3072aded31c3f39ca3afd179a35384a2750e4c951, 91208 bytes) among its files

The test went to a blind redraft, `tests/acceptance/192/packs-redraft-2892/`, which reads each file as the page does
(inflated where stored gzip) and keeps the install half as written. It runs in this file's place
(`scripts/lanes.mjs`); `outside.test.ts` moves to the by-hand list.
