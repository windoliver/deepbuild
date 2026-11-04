#!/usr/bin/perl
# A fake `claude` for the #87 models tests (README, The fake CLI). It answers what DeepBuild's runner asks of Claude
# Code (`--version`, `auth status`, and a headless run: `-p --output-format stream-json --verbose`, the prompt on
# stdin) and, for a headless run, prints one recorded stream-json run: the one its prompt names on a line of its own,
# `@stream <name>`. The recorded runs are baked in when the test installs it (helpers.ts, `install`), in Claude Code's
# own shapes: system/init, assistant messages (message.id, message.model, message.usage) and a result event
# (session_id, total_cost_usd, usage, modelUsage). `__SESSION__` in a recorded line is this run's session ID. Like
# Claude Code, it refuses to start inside another Claude Code session (CLAUDECODE=1). It makes no network call.
use strict;
use warnings;
use JSON::PP;
use MIME::Base64 qw(decode_base64);

my $VERSION = '__VERSION__';
my $STREAMS = decode_json(decode_base64('__STREAMS__'));
$| = 1;

sub uuid {
  open(my $r, '<', '/dev/urandom') or return sprintf('%08x-0000-4000-8000-%012x', $$, time);
  read($r, my $b, 16); close $r;
  my $h = unpack('H*', $b);
  return join('-', substr($h, 0, 8), substr($h, 8, 4), '4' . substr($h, 13, 3), '8' . substr($h, 17, 3), substr($h, 20, 12));
}

my @argv = @ARGV;
if (grep { $_ eq '--version' || $_ eq '-v' } @argv) { print "$VERSION (Claude Code)\n"; exit 0; }
if (@argv >= 2 && $argv[0] eq 'auth' && $argv[1] eq 'status') {
  print encode_json({ loggedIn => JSON::PP::true, authMethod => 'claude.ai', apiProvider => 'firstParty', subscriptionType => 'max' }), "\n";
  exit 0;
}
if (($ENV{CLAUDECODE} // '') eq '1') {
  print STDERR "Error: Claude Code cannot be launched inside another Claude Code session.\n";
  exit 1;
}
unless (grep { $_ eq '-p' || $_ eq '--print' } @argv) { print STDERR "fake claude: only headless runs (-p) are modelled\n"; exit 1; }

my $prompt = do { local $/; <STDIN> } // '';
my ($name) = $prompt =~ /^\@stream\s+(\S+)\s*$/m;
my $lines = defined $name ? $STREAMS->{$name} : undef;
unless (ref $lines eq 'ARRAY') { print STDERR "fake claude: the prompt names no recorded stream (\@stream <name>)\n"; exit 1; }
my $session = uuid();
for my $line (@$lines) {
  (my $out = $line) =~ s/__SESSION__/$session/g;
  print STDOUT "$out\n";
}
exit 0;
