#!/bin/sh
# #3016 criterion 5: writes down every frame hash the four suites draw, as fixtures/base-frames/<suite>.jsonl, with the
# machine's model in fixtures/base-frames/machine.json. Run once, from the checkout root, on the merge base (README).
set -u
here="tests/acceptance/3016"
out="$here/fixtures/base-frames"
mkdir -p "$out"
printf '{"model": "%s", "os": "%s"}\n' "$(sysctl -n hw.model)" "$(sw_vers -productVersion)" > "$out/machine.json"
for suite in 465 506 462 166; do
  rm -f "$out/$suite.jsonl"
  ACCEPTANCE_3016_FRAMES="$PWD/$out/$suite.jsonl" npx vitest run --root "tests/acceptance/$suite" \
    --config "$PWD/$here/frames/record.config.ts" --no-file-parallelism > "target/3016-frames-$suite.log" 2>&1
  echo "suite $suite: vitest exit $?" >> "target/3016-frames-runs.txt"
done
