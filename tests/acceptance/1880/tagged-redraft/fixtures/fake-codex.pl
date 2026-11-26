#!/usr/bin/perl
# A fake `codex` for #1880's acceptance tests (README, Stand-ins). Perl, as tests/acceptance/39's fake codex, so it runs
# inside the runner's sandbox with nothing but /usr/bin. No network, no model. The test writes this file into the login
# PATH with its version placeholder replaced by a version Codex's facts cover.
#   --version          prints `codex-cli <version>`
#   login status       exits 0: signed in, as Codex's own probe reads it
#   exec --json ... -  reads the prompt on stdin and prints Codex's JSON events: thread.started, its argv as a `fake`
#                      line, an agent message holding an empty reading.answer@1, turn.completed
use strict;
use warnings;
use JSON::PP;

my $version = '__VERSION__';
my $json = JSON::PP->new->canonical(1);
if (@ARGV && $ARGV[0] eq '--version') { print "codex-cli $version\n"; exit 0; }
if (@ARGV >= 2 && $ARGV[0] eq 'login' && $ARGV[1] eq 'status') { print "Logged in using ChatGPT\n"; exit 0; }
exit 2 unless @ARGV && $ARGV[0] eq 'exec';
$| = 1;
my $stdin = do { local $/; <STDIN> } // '';
my $thread = '019a1880-0000-7000-8000-000000001880';
print $json->encode({ type => 'thread.started', thread_id => $thread }), "\n";
print $json->encode({ type => 'turn.started' }), "\n";
print $json->encode({ type => 'fake', argv => [@ARGV], prompt_bytes => length($stdin) }), "\n";
print $json->encode({ type => 'item.completed', item => { id => 'item_0', type => 'agent_message', text => '{"findings":[]}' } }), "\n";
print $json->encode({ type => 'turn.completed', usage => { input_tokens => 10, cached_input_tokens => 0, output_tokens => 5 } }), "\n";
exit 0;
