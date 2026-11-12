# What each #1468 screenshot recorded, run from the tree under test: it prints each command before
# it runs it, then its exit code, so the picture shows the command that ran and where its binaries came from.
# Usage: bash shots.sh e2e|acceptance
here=$(cd "$(dirname "$0")" && pwd)
x() { printf '$ %s\n' "$*"; "$@"; echo "[exit $?]"; }
echo "# $(date -u +%FT%TZ), $(uname -sm), $(nproc) cores, load $(cut -d' ' -f1 /proc/loadavg)"
x git log -1 --format='%H %s'
x git status --short
case $1 in
e2e)
    x cargo build --locked -q -p deep-motion -p deep-show --bins
    x sha256sum target/debug/deep-motion target/debug/deep-show
    x python3 -I "$here/e2e.py" target/debug
    ;;
acceptance)
    x cargo test --locked -q -p deep-motion --test acceptance_1468 -- --test-threads=1 --nocapture
    ;;
esac
