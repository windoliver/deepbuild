# Security

DeepBuild's guards stand between an agent and what it must not do. Once other people run it, an open report of a way past one is a recipe against them until a release carries the fix. So some reports go privately.

## Report these privately

- A way past a guard or the hook.
- A way out of the sandbox.
- A way onto the trusted card.
- A way to a credential, or to another session's data.

## How

Use this repository's private report form: <https://github.com/windoliver/deepbuild/security/advisories/new>. It opens a draft advisory that only you and the maintainers can read. Until its fix has merged, put no details in an issue, pull request, discussion or commit message.

## What you hear back

An acknowledgement in the advisory within three working days. That figure is drafted and may change once reports come in. Any fix is worked out in the advisory.

## Everything else

Everything else is a public issue: <https://github.com/windoliver/deepbuild/issues/new/choose>.

## The rule

A report that fits the private list in SECURITY.md and isn't public yet is handled in the private advisory, and its public issue is filed when its fix has merged, naming the fix. An agent that finds such a fault tells the person it works for and files nothing public. Issues already open stay as they are. <!-- security rule -->
