# Work sources

Work sources DeepBuild ships (#66). Each is a package with one stream source whose reading is `work.item@1`: you switch
it on over a scope, and its items become tasks that link back to where they came from, and results go back there.

- `linear`: a Linear team's issues (scope: a team key, such as `LIN`), read with your API key (`linear_key`). An item's
  ID is the issue's identifier (`LIN-42`); each comment is a reading of its own. A role comes from the team's membership.
- `gmail`: the emails in a Gmail label (scope: a label ID, such as `Label_7`), read with an OAuth token (`gmail_token`).
  An item is a message; a delivery is a reply in its thread, to the sender.

The package's code only lists, reads, delivers and finds its marker. Every provider call goes through the hub
(`ctx.fetch`), which holds it to the source's host, secret and quota.
