#!/bin/sh
# A stand-in `codex`: answers the runner's --version and `login status` (its exit code only), and for `exec` reads its
# prompt on stdin and prints events shaped as `codex exec --json` prints them. No model, no network.
# Driven by lines in the prompt: `@thread <id>` is its thread ID; `@hold-thread` waits for a file `release-thread` in
# its folder before it prints that ID. It always waits for a file `release` in its folder before it ends its turn.
case "$1" in
  --version) echo "codex-cli __VERSION__"; exit 0 ;;
  login) exit 0 ;;
esac
[ "$1" = exec ] || { echo "stand-in codex: expected exec, got: $*" >&2; exit 64; }
prompt=$(/bin/cat)
thread=$(printf '%s\n' "$prompt" | /usr/bin/sed -n 's/^@thread //p')
hold=$(printf '%s\n' "$prompt" | /usr/bin/sed -n 's/^@hold-thread$/yes/p')
argv=$(printf '%s' "$*" | /usr/bin/tr -d '"\\')
wait_for() {
  i=0
  while [ ! -e "$1" ] && [ "$i" -lt 900 ]; do /bin/sleep 0.1; i=$((i + 1)); done
}
[ "$hold" = yes ] && wait_for release-thread
printf '{"type":"thread.started","thread_id":"%s"}\n' "$thread"
printf '{"type":"turn.started"}\n'
printf '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"stand-in argv: %s"}}\n' "$argv"
wait_for release
printf '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Done."}}\n'
printf '{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":100,"output_tokens":50}}\n'
exit 0
