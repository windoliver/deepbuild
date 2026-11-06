#!/bin/sh
# The app's call to the sample API, and what the app would log of its key.
port=$(cat .app-port)
curl -s "http://127.0.0.1:$port/call"
echo
curl -s "http://127.0.0.1:$port/leak"
echo
