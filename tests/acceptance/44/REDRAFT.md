# Blind redraft: the `drops-mode` twin (R1 `#44.2d670703`)

Changed only the wrong-program test for `drops-mode` ("leases every call exclusive") in `lease.test.ts`. `bothShared`
and the plant's name and description are unchanged.

From the criterion: the host leases with the caller's mode. A host that passes `exclusive` to the table whatever the
package asked grants alpha's first shared lease on `rig-s` (the key is free), and the table returns a lease whose mode
is `exclusive`. `grantedTo` checks error, status, holder and resource (all pass), then `l.mode` against `shared`: that
is the first assertion to fail, for `ext:test/alpha`, before beta's call runs. The old pattern expected beta's refusal,
which such a host never reaches. The redraft expects alpha's mode failure:
`{kind: device.rig, key: rig-s}, shared) for ext:test/alpha: its mode as asked: expected 'exclusive' to be 'shared'`.
