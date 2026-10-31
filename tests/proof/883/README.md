# #883's Proof on a Mac

The issue's Proof asks for Notification Center before and after each case, on a Mac, and the restart case failing on
the merge base. The acceptance tests themselves are `tests/acceptance/883` (the replica, on a virtual clock); this
folder holds the two runs that need the real OS or the base.

## Notification Center, live

`notification-center.live.test.ts` runs the app bundle against a real hub in a temporary home (#667's helpers: the
hub, agent stand-ins that ask through `deep_ask`, and `deep inbox answer`). After each step it writes the OS's own
list of what Notification Center holds from the app (`deep-app --notification-center`) and the app's
`notified`/`withdrew` lines to `out/notification-center.txt`:

- AC1: an ask notifies, `deep inbox answer` answers it, and 2 s later Notification Center holds nothing for it.
- AC2: two asks from one session 30 s apart leave one notification, the second's; another session's leaves a second.
- AC3 in part: the default reads as a clock time with its day ("on Tue 3 Nov at 13:09"). The issue's exact cases
  (16:40 today, tomorrow) need a set deadline, which `deep_ask` doesn't take; the replica's suite proves them.
- AC4: quitting and reopening the app, then restarting the hub, posts nothing again; a new ask still notifies.
- On start the app withdraws what an earlier run left for sessions with no open ask, and answering what is left
  open at the end empties Notification Center.

It runs by hand (it is in `byHand` in scripts/lanes.mjs): the bundle must be allowed to notify, in System Settings ›
Notifications › DeepBuild. Sign the bundle with a stable identity, or macOS asks again after every build:

```sh
DEEP_APP_SIGN="<your signing identity>" scripts/app-bundle
node node_modules/vitest/vitest.mjs run tests/proof/883/notification-center.live.test.ts
```

## The restart case on the merge base

`restart_on_base.rs` hands the notifier the record's events a second time, as the reader does after a hub restart
or a channel reconnect. Copied into `crates/deep-app/tests/` of a checkout of 0f7fb686 it fails at its assertion,
naming the ask; on this change it passes. `out/restart-on-base.txt` holds both runs. The base app posts no OS
notification at all, so the base can't fail the live run above.
