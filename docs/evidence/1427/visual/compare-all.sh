#!/bin/bash
# Usage: compare-all.sh <main dir> <head dir> <crops dir>  — one line per main/head pair, a crop for each differing pair.
cd "$(dirname "$0")"
mkdir -p "$3"
for f in "$2"/*.png; do
  b=$(basename "$f" .png)
  if cmp -s "$1/$b.png" "$f"; then echo "$b: identical (byte-equal PNG)"
  else echo "$b: $(python3 -I pixdiff.py "$1/$b.png" "$f" "$3/$b.png")"; fi
done
