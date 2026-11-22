# deep-relay

## What it is for

relay@1 (#309; canvas primitives: Net: relay protocol `relay@1`) and everything that speaks it today: the relay DeepBuild ships for you to run on one of your own hosts (`deep-relay`), the relay suite every relay must pass (`deep-relay-suite`), and the network seam's macOS backend (`network.macos`), which the net module (#179) and game.online (#218) build on. It carries frames: nothing here reads a piece, a match's state or an engine. DeepBuild runs no relay and no service.

Run the shipped relay on your host, behind your certificate:

```sh
deep-relay --listen 0.0.0.0:443 --cert fullchain.pem --key privkey.pem
```

## Where new code goes

- `src/wire.rs`: relay@1's committed digest, limits, hello check and frame layout; the one module a wasm32 build links, for the web player (#549). The shape itself is `packages/contracts/slots/relay@1.json`, frozen in `packages/contracts/digests.json`; a new shape is `relay@2` there, never an edit.
- `src/relay.rs`: the shipped relay. `src/suite.rs`: the relay suite and its frame reader. Both speak relay@2 (#277, `packages/contracts/slots/relay@2.json`) beside relay@1: a copy asks for it by the WebSocket subprotocol `relay.2`, and the relay hands its `holds`, `seat` and `catch_up` to the match's other copies, naming the sender.
- `src/macos.rs`: the macOS backend: its https connection and joining, and its session (relay@1's repeat rule) that the network seam's suite plays. A Join's connection trusts the platform's own authorities beside the ones its caller hands it (#549).
- `src/direct.rs`: the direct path between two copies in the app (#549): the lower-numbered copy listens where it reaches the relay from and says where through the relay's `signal`, with an offer drawn for that match.
- `src/bin/`: the two binaries. Proofs: unit tests beside the code, and `tests/acceptance/309`. `scripts/relay-kit.mjs` (the lane `relay`) runs the relay suite on the shipped relay and the interop run against every relay implementation.

## What it may import

deep-canvas-seams (the network seam's interface), rustls with ring, rustls-pki-types, rustls-native-certs, tungstenite and serde_json; off wasm32, serde_json and deep-canvas-seams alone. Not named deep-canvas*: it holds threads, sockets and clocks, which the canvas lint keeps out of the canvas crates.

## Deviations

- A direct path opens only between copies that reach each other at the address each reaches the relay from, as on one network; it sets up no path through a NAT, and its frames cross it unencrypted, named by the match and the offer the relay's `signal` carried. Any other pair plays through the relay.
