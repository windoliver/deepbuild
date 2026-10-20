#!/bin/sh
# Throwaway #80 spike helper: once <session> has had <stops> Stop hooks reply, wait <idle> seconds
# and write a fresh answer to <folder>/.spike/answer.txt for the asyncRewake waiter to deliver.
# usage: answer-when-idle.sh <log> <session> <stops> <idle> <folder>
log=$1 session=$2 stops=$3 idle=$4 folder=$5
until [ "$(jq -s --arg s "$session" '[.[]|select(.session==$s and .event=="Stop" and .role=="main" and .phase=="reply")]|length' "$log")" -ge "$stops" ]; do sleep 1; done
sleep "$idle"
echo "the code word is wake$(openssl rand -hex 5)" > "$folder/.spike/answer.txt"
