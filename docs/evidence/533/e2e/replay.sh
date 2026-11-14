# Criterion 1's replay: the live run's steps, then a second process opened on the track the live run recorded and
# stepped with nothing delivering. Run from the scratch folder.
set -euo pipefail
R='select(.steps) | .steps[] | {step, hash: .items.listen.hash, arrays}'
bin/deep-logic < evin/readings.in | jq -c "$R" > live.steps
TRACK=$(bin/deep-logic < evin/readings.in | jq -c 'select(.track) | .track' | tail -1)
echo "recorded track: $TRACK"
{ head -1 evin/readings.in | jq -c --argjson t "$TRACK" '.track = $t'; echo '{"call":"step","session":"s1","to":4}'; } \
  | bin/deep-logic | jq -c "$R" > replay.steps
[ "$(wc -l < live.steps)" = 5 ] || { echo 'the live run gave no five steps'; exit 1; }
diff live.steps replay.steps && echo 'the replay reads the same values with the same hash at every step:' && cat replay.steps
