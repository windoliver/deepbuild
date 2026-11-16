#!/bin/sh
# Drafted check: a token that has not expired is accepted.
node -e "process.exit(require('./src/auth.js').checkToken({ exp: 4102444800 }) === true ? 0 : 1)"
