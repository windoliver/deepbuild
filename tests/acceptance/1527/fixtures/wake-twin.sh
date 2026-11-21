#!/bin/sh
# A planted wake test that wakes on any byte that changed, so it wakes on the twin: the same stories, fetched again.
if cmp -s "$1" "$2"; then echo "nothing new"; else echo "new"; fi
