// Preloaded into the hub for AC10 (NODE_OPTIONS=--require <this file>), in its main thread and each worker: every TCP
// or UDP connect and every DNS lookup the process makes is appended to $FIXTURE_NET_LOG as one JSON line with its time.
// A connect to a path (a Unix socket, as the hub's own) is local and not written. It only watches; it blocks nothing.
'use strict';
const { appendFileSync } = require('node:fs');
const net = require('node:net');
const dns = require('node:dns');
const dgram = require('node:dgram');

const FILE = process.env.FIXTURE_NET_LOG;
const log = (what) => { if (FILE) try { appendFileSync(FILE, `${JSON.stringify({ at: Date.now(), pid: process.pid, ...what })}\n`); } catch { /* the log is gone */ } };

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // net.connect hands its arguments on normalized, as an array whose first item is the options.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof first === 'object' && first !== null ? first : undefined;
  const path = options ? options.path : typeof first === 'string' && !/^\d+$/.test(first) ? first : undefined;
  if (path === undefined) log({ call: 'connect', host: options ? options.host ?? 'localhost' : String(args[1] ?? 'localhost'), port: options ? options.port : first });
  return connect.apply(this, args);
};
for (const target of [dns, dns.promises]) {
  for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']) {
    const original = target[name];
    if (typeof original !== 'function') continue;
    target[name] = function (host, ...rest) {
      log({ call: `dns.${name}`, host: String(host) });
      return original.call(this, host, ...rest);
    };
  }
}
const send = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function (...args) {
  log({ call: 'udp.send' });
  return send.apply(this, args);
};
