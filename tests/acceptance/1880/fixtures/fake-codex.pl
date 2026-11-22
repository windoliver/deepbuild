#!/usr/bin/perl
# A fake `codex` for the #1880 acceptance tests (README, The fake Codex): the model and the CLI are the one boundary
# these tests don't own. It answers what DeepBuild asks of Codex, as its facts (adapters/codex.facts.json) name it:
#
# - `--version`: `codex-cli __VERSION__`, a version the facts cover.
# - `login status`: exit 0, signed in (the facts' signIn: "exit code 0").
# - `exec ... -` (the facts' readOnlyJob launch, prompt on stdin): `codex exec --json` lines as Codex writes them:
#   thread.started, one agent_message whose text is a reading.answer@1 with no findings, and turn.completed with usage.
#   Before those it prints one line of its own, `{"type":"fake.codex","argv":[...],"stdin_bytes":n}`, which no real
#   Codex prints, so a job's output shows that this program was the job's process and what it was launched with.
#
# Every call is also appended to __LOG__ (one JSON line: argv and pid) when the call may write there. A job's process
# runs in the runner's sandbox, which refuses that write, so the log shows only calls made outside a job; a job's own
# start is read from the job record and the line above. It reads no network and calls no model.
use strict;
use warnings;
use JSON::PP;

my $VERSION = '__VERSION__';
my $LOG = '__LOG__';
my $json = JSON::PP->new->canonical(1);
$| = 1;

if (open(my $f, '>>', $LOG)) { print $f $json->encode({ argv => [@ARGV], pid => $$ }), "\n"; close $f; }

my @argv = @ARGV;
if (grep { $_ eq '--version' || $_ eq '-V' } @argv) { print "codex-cli $VERSION\n"; exit 0; }
if (@argv >= 2 && $argv[0] eq 'login' && $argv[1] eq 'status') { print "Logged in using ChatGPT\n"; exit 0; }
if (@argv && $argv[0] eq 'exec') {
  local $/;
  my $stdin = <STDIN> // '';
  print $json->encode({ type => 'fake.codex', argv => [@argv], stdin_bytes => length($stdin) }), "\n";
  my $thread = sprintf('0199aaaa-0000-7000-8000-%012x', $$);
  print $json->encode({ type => 'thread.started', thread_id => $thread }), "\n";
  print $json->encode({ type => 'turn.started' }), "\n";
  print $json->encode({ type => 'item.completed', item => { id => 'item_0', type => 'agent_message', text => '{"findings":[]}' } }), "\n";
  print $json->encode({ type => 'turn.completed', usage => { input_tokens => 1200, cached_input_tokens => 0, output_tokens => 20 } }), "\n";
  exit 0;
}
print STDERR "fake codex: unsupported call: @argv\n";
exit 2;
