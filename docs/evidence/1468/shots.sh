# What each #1468 screenshot recorded, run from the tree under test: it prints each command before
# it runs it, then its exit code, so the picture shows the command that ran and where its binaries came from.
# Usage: bash shots.sh e2e|acceptance
here=$(cd "$(dirname "$0")" && pwd)
x() { printf '$ %s\n' "$*"; "$@"; local rc=$?; echo "[exit $rc]"; return $rc; }
echo "# $(date -u +%FT%TZ), $(uname -sm), $(nproc) cores, load $(cut -d' ' -f1 /proc/loadavg)"
x git rev-parse HEAD
x git --no-pager log -1 --format=%s
x git status --short
case $1 in
e2e)
    # Only binaries this build made run: each one whose build passed is copied to a fresh folder.
    bins=$(mktemp -d)
    x cargo build --locked -q -p deep-motion -p deep-show --bins && cp target/debug/deep-motion target/debug/deep-show "$bins/"
    x bash -c "cargo build --locked -q -p deep-marks-render --bin deep-canvas-render 2>&1 | grep -A3 '^error' | head -8; exit \${PIPESTATUS[0]}" && cp target/debug/deep-canvas-render "$bins/"
    x sha256sum "$bins"/*
    x python3 -I "$here/e2e.py" "$bins"
    ;;
acceptance)
    x cargo test --locked -q -p deep-motion --test acceptance_1468 -- --test-threads=1 --nocapture
    ;;
esac
