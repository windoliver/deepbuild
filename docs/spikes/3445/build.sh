#!/bin/sh
# Spike #3445: one release build of the binaries a reading runs, in a scratch copy of the tree, never in a checkout a
# session works in. The copy is put back to its commit, the patches named are applied, tracker.rs is laid in as an
# example of deep-logic, and the canvas core and deep-logic are built as the release and the metering benchmark build
# them (scripts/release-stage.mjs, benchmarks/logic.mjs): cargo build --release --locked, no compiler wrapper. The
# binaries and a build.json that says what they are go to <out>/<label>/.
#
#   [LOGIC_ONLY=1] sh docs/spikes/3445/build.sh <scratch copy> <out> <label> [patch ...]
#
# The patches are files of docs/spikes/3445/patches/. parallel-compilation.manifests.patch adds a dependency edge
# the lock doesn't hold, so its build runs --offline in place of --locked and keeps the lock's change beside the
# binaries as Cargo.lock.patch. A release canvas core seals only the canvas modules its embedded kit ledger holds at
# their digests; DEEP_KIT_LEDGER, when set, names the ledger the build embeds in place of the tree's
# (crates/deep-show/build.rs), and build.json says which. Run it under the machine's build grant
# (scripts/throttle.mjs build).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
S=$1
OUT=$2
LABEL=$3
shift 3
cd "$S"
EXAMPLE=crates/deep-logic/examples/spike3445_tracker.rs
rm -f "$EXAMPLE"
git checkout -q -- .
test -z "$(git status --porcelain)" || { echo "the scratch copy holds more than its commit:"; git status --short | head; exit 1; }
LOCKED=--locked
PATCHES=
for p in "$@"; do
  git apply "$HERE/patches/$p"
  PATCHES="$PATCHES{\"file\":\"patches/$p\",\"sha256\":\"$(shasum -a 256 "$HERE/patches/$p" | cut -d' ' -f1)\"},"
  case $p in parallel-compilation.*) LOCKED=--offline ;; esac
done
mkdir -p crates/deep-logic/examples
cp "$HERE/tracker.rs" "$EXAMPLE"
# LOGIC_ONLY=1 leaves the canvas core out: a copy kept for the metering benchmark and the goldens needs deep-logic alone.
if [ -n "$LOGIC_ONLY" ]; then BINS="-p deep-logic --bin deep-logic"; else BINS="-p deep-show --bin deep-show -p deep-logic --bin deep-logic"; fi
COMMAND="cargo build --release $LOCKED -j ${JOBS:-10} $BINS --example spike3445_tracker"
echo "$LABEL: $COMMAND, at $(git rev-parse HEAD) with ${*:-no patch}, load $(uptime | sed 's/.*averages: //')"
mkdir -p "$OUT/$LABEL"
RUSTC_WRAPPER= CARGO_INCREMENTAL=0 nice -n 10 $COMMAND 2>&1 | tee "$OUT/$LABEL/cargo.log" | tail -3
FINISHED=$(grep -E '^ +Finished ' "$OUT/$LABEL/cargo.log" | tail -1 | sed 's/^ *//')
test -n "$FINISHED" || { echo "cargo didn't finish"; exit 1; }
# The metering benchmark builds deep-logic itself, in the tree it runs in (benchmarks/logic.mjs): its own command
# here, so that it finds the binary built when it is run under the timed grant.
BENCHMARK="cargo build --locked --release -p deep-logic --bin deep-logic"
if [ "$LOCKED" = --locked ]; then RUSTC_WRAPPER= CARGO_INCREMENTAL=0 nice -n 10 $BENCHMARK -j ${JOBS:-10} 2>&1 | tail -1; fi
test -n "$LOGIC_ONLY" || cp target/release/deep-show "$OUT/$LABEL/"
cp target/release/deep-logic target/release/examples/spike3445_tracker "$OUT/$LABEL/"
git diff -- Cargo.lock > "$OUT/$LABEL/Cargo.lock.patch"
test -s "$OUT/$LABEL/Cargo.lock.patch" || rm "$OUT/$LABEL/Cargo.lock.patch"
sum() { shasum -a 256 "$1" | cut -d' ' -f1; }
cat > "$OUT/$LABEL/build.json" <<EOF
{
 "label": "$LABEL",
 "base": "$(git rev-parse HEAD)",
 "patches": [${PATCHES%,}],
 "example": {"file": "tracker.rs", "sha256": "$(sum "$HERE/tracker.rs")"},
 "ledger": $(test -n "$DEEP_KIT_LEDGER" && echo "{\"file\": \"$(basename "$DEEP_KIT_LEDGER")\", \"sha256\": \"$(sum "$DEEP_KIT_LEDGER")\"}" || echo null),
 "command": "$COMMAND",
 "finished": "$(echo "$FINISHED" | sed 's/ in .*//')",
 "rustc": "$(rustc -V)",
 "date": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
 "sha256": {
  "deep-show": $(test -n "$LOGIC_ONLY" && echo null || echo "\"$(sum "$OUT/$LABEL/deep-show")\""),
  "deep-logic": "$(sum "$OUT/$LABEL/deep-logic")",
  "spike3445_tracker": "$(sum "$OUT/$LABEL/spike3445_tracker")"
 }
}
EOF
cat "$OUT/$LABEL/build.json"
