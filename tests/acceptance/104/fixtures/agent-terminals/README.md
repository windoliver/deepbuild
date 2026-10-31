# Agent terminals

Built from one sentence: "Host my agents' terminals in tabs, and keep them running when I quit the app".

- It asks for one permission, run-as-you (`run_as_you`): it can run any command you could. You approve it once on
  the trusted path, Show what changed lists it, and you can revoke it at once; every process it started stops then.
- Its host process runs terminals, lives past the app and owns them, so quitting the app leaves them running and the
  next launch shows them again, one tab each.
- It never types into a terminal: input comes only from the panel you focused.
- Its own tests are its two check kinds: `ext.agent-terminals.hosts` (a heartbeat terminal opens and its tab shows
  it beating) and `ext.agent-terminals.shows_again` (at a later launch the same tab shows it, still beating, with no
  beat lost).
