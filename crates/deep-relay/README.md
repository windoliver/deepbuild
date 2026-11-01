# deep-relay

## What it is for

relay@1 (#309; canvas primitives: Net: relay protocol `relay@1`) and everything that speaks it today: the relay DeepBuild ships for you to run on one of your own hosts (`deep-relay`), the relay suite every relay must pass (`deep-relay-suite`), and the network seam's macOS backend (`network.macos`), which the net module (#179) and game.online (#218) build on. It carries frames: nothing here reads a piece, a match's state or an engine. DeepBuild runs no relay and no service.

Run the shipped relay on your host, behind your certificate:

```sh
deep-relay --listen 0.0.0.0:443 --cert fullchain.pem --key privkey.pem
```

## Where new code goes

- `src/wire.rs`: relay@1's committed digest, limits and frame layout. The shape itself is `packages/contracts/slots/relay@1.json`, frozen in `packages/contracts/digests.json`; a new shape is `relay@2` there, never an edit.
- `src/relay.rs`: the shipped relay. `src/suite.rs`: the relay suite and its frame reader.
- `src/macos.rs`: the macOS backend: its https connection, hello check and joining, and its session (relay@1's repeat rule) that the network seam's suite plays.
- `src/bin/`: the two binaries. Proofs: unit tests beside the code, and `tests/acceptance/309`. `scripts/relay-kit.mjs` (the lane `relay`) runs the relay suite on the shipped relay and the interop run against every relay implementation.

## What it may import

deep-canvas-seams (the network seam's interface), rustls with ring, rustls-pki-types, tungstenite and serde_json. Not named deep-canvas*: it holds threads, sockets and clocks, which the canvas lint keeps out of the canvas crates.

## Deviations

- The macOS backend always goes through the relay: the relay hands `signal` messages on, but no direct path between copies opens yet.
- The macOS backend trusts the certificate authorities its caller hands it; the platform's own roots come with the Join that uses it (#179).
