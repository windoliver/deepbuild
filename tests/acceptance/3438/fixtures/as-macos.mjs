// Preloaded into `deep` only where a test runs on a machine that isn't macOS (README: Criterion 1 on another system).
// The base picks the login service's definition by `process.platform`, with no other way to ask for the macOS one, and
// the issue has the definition's text tested on any machine. So there the child is told it runs on macOS: the platform
// is the one thing stood in for, and the definition it then writes is the one a Mac's `deep` writes. Never loaded on a
// Mac, and never into a process that could reach a service manager: the child's launcher is a stand-in that starts
// nothing.
Object.defineProperty(process, 'platform', { value: 'darwin' });
