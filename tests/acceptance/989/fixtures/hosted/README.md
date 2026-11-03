# Hosted

The #989 acceptance tests' piece: it hosts terminals in tabs and keeps them running past the app, as #104's
agent-terminals does, and lets its caller choose each terminal's start size and close a terminal.

- It asks for run-as-you (`run_as_you`); its host process runs terminals, lives past the app and owns them.
- It never types into a terminal and never sizes one: input and the tab's size come only from the app.
- Actions: `ext.hosted.open` ({argv, cwd, title, cols, rows}), `ext.hosted.tabs`, `ext.hosted.read` ({terminal, from})
  and `ext.hosted.close` ({terminal}).
