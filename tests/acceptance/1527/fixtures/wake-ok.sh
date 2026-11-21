#!/bin/sh
# The wake test of the team feed (#1527 README: The contract), run on each fire with no model.
# $1: the feed as the last fire read it. $2: the feed now. It answers new when the feed holds a story the
# last copy did not, nothing new when its stories are the same, and fails (exit 2) on a feed that is not JSON.
case "$(head -c 1 "$2")" in
  '{') ;;
  *) echo "the feed is not JSON" >&2; exit 2 ;;
esac
was=$(grep '"id"' "$1" 2>/dev/null | sort)
now=$(grep '"id"' "$2" | sort)
if [ "$was" = "$now" ]; then echo "nothing new"; else echo "new"; fi
