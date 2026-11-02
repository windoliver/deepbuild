#!/usr/bin/perl
# A stand-in `codex` for #39 AC26 (README). `exec` reads its prompt from stdin, and for each `@sh <command>` line
# really runs that command with /bin/sh in its own working folder, printing what `codex exec --json` prints: the
# command's real output, exit code and a status from that exit code. It never looks at its sandbox flags, so nothing
# here can fake a refusal: only the operating system can make a write fail.
use strict;
use warnings;
use JSON::PP;
use MIME::Base64;

my @argv = @ARGV;
if (@argv && $argv[0] eq '--version') { print "codex-cli 0.160.0\n"; exit 0; }
if (@argv >= 2 && $argv[0] eq 'login' && $argv[1] eq 'status') { print "Logged in\n"; exit 0; }
unless (@argv && $argv[0] eq 'exec') { print STDERR "stand-in codex: only exec, login status and --version\n"; exit 2; }

my $json = JSON::PP->new->canonical->allow_nonref;
$| = 1;
sub emit { print $json->encode($_[0]), "\n"; }

my $prompt = do { local $/; <STDIN> };
$prompt = '' unless defined $prompt;

emit({ type => 'thread.started', thread_id => '0199a213-81c0-7800-8aa1-bbab2a035a53' });
emit({ type => 'turn.started' });
emit({ type => 'item.completed', item => { id => 'item_0', type => 'agent_message',
  text => 'standin:' . $json->encode({ argv => \@argv, stdin => encode_base64($prompt, '') }) } });

my $n = 0;
for my $line (split /\n/, $prompt) {
  next unless $line =~ /^\@sh (.+)$/;
  my $command = $1;
  $n++;
  my $pid = open(my $out, '-|');
  die "stand-in codex: fork: $!" unless defined $pid;
  if (!$pid) {
    open(STDERR, '>&', \*STDOUT);
    exec('/bin/sh', '-c', $command) or die "exec: $!";
  }
  my $output = do { local $/; <$out> };
  close $out;
  my $code = $? >> 8;
  emit({ type => 'item.completed', item => { id => "item_$n", type => 'command_execution', command => "/bin/sh -c '$command'",
    aggregated_output => $output // '', exit_code => $code + 0, status => $code == 0 ? 'completed' : 'failed' } });
}

emit({ type => 'item.completed', item => { id => 'item_last', type => 'agent_message', text => 'Done.' } });
emit({ type => 'turn.completed', usage => { input_tokens => 10, cached_input_tokens => 0, output_tokens => 5 } });
exit 0;
