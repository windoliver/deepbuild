# Channels

## What it is for

The first channel plug-ins (#65): `paseo` (paseo's relay to your phone, whose app signs answers with its paired key), `chat`, `email` and `text`. Each is a DeepBuild package of its own, installed with `deep install packages/channels/<name>`, that calls `deep.registerChannel` once and passes channel@1's kit at install. A channel only transports: the hub renders each item, makes every provider call through `ctx.fetch` (adding the channel's token, which `~/.deepbuild/channels.json` names by handle, `"secret": "secret:channels/<name>"`, from the OS secret store, where `deep secret add channels <name>` puts it and a plain `token` left in the file moves at the hub's next start), and checks each answer's proof itself (`packages/hub/src/channels.ts`).

## Where new code goes

- `<name>/index.ts`: the channel's deliver and receive; `<name>/deepbuild.json`: its manifest, whose `digest` is the folder's `packageDigest` and changes with every byte of the folder.
- A new channel is a new folder here with both files, and its provider's protocol in its own `index.ts`.

## What it may import

Nothing: each folder is copied alone at install and runs in the platform sandbox, so it imports no other package and no other folder here, and reaches its provider only through `ctx.fetch`.

## Deviations

- The four folders repeat the same small protocol code: a package is installed alone, so they can't share a module.
- No `package.json`: these are DeepBuild packages, not npm workspaces.
