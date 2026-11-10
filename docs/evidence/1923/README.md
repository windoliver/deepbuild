# #1923 proof

These are the blind suite's proof files (`tests/acceptance/1923/`, run with `--no-file-parallelism` on macOS arm64, Node 24.22.0) from the run on the merge of main into the branch. 5 of 5 tests passed. Every hub, plug-in and tool ran under `/tmp/dh1923-*` with a temp `HOME`. The provider was a local HTTP server on 127.0.0.1 that counted every submission. Nothing left 127.0.0.1, and no model was called.

| File | What it shows |
|---|---|
| `ac1-retry.json` | The paid run on "abc" reaches the provider once. When the request arrives, the journal under `jobs/` already holds `{key, provider}`, and after the answer it holds the key with `task-2`. The key equals the receipt's. The run on "xyz" is held at the provider and the hub is SIGKILLed. After the restart, two retries make no call (one submission of "xyz" in all) and both reply `BLOCKED`, naming one unblock ask whose question names `127.0.0.1:<port>` and the full key. |
| `ac1-planted-tool-hosted-resubmit@1.0.0.json` | The planted tool records its key only with the answer. Its retry makes a second call, and the judge fails it, naming the second call and the key. |
| `ac2-join.json` | A's run is held at the provider. B's same run is still unanswered 3 s later. B is cancelled with `notifications/cancelled`, and the provider's request stays open and A unanswered. C's same run waits too. After the answer, A and C get SHA-256("ABC"), C's receipt says `joined: true`, B gets no reply, and the provider counts one call. |
| `ac2-planted-job-second-call.json` | The runner that runs the tool again makes 2 calls. The judge fails it, naming the key and the second call. |
| `ac2-planted-job-joiner-cancels-job.json` | The runner that stops the job on a joiner's cancel drops the provider's request. The judge fails it with "cancelling the joining request…", naming the key. |
