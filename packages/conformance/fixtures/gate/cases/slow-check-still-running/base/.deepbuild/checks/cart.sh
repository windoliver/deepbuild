#!/bin/sh
node -e 'setTimeout(() => {}, 15000)' && node --test test/cart.test.js
