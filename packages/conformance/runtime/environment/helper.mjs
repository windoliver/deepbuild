// A fixture environment's helper (#314): a process carrying the run token on its command line that listens on
// nothing and outlives the server it came from, unless down reaches it. The kit's down rule finds it by the
// token; the kit stops it itself when a planted fill leaves it.
//   node helper.mjs <runToken>
setTimeout(() => process.exit(0), 60_000);
process.on('SIGTERM', () => process.exit(0));
