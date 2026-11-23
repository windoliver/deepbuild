#!/usr/bin/perl
# A stand-in `claude` for #2650's job tests (README, The stand-in agent). It answers what the runner asks of Claude
# Code: `--version`, with a version the adapter facts cover, and a headless run (`-p --output-format stream-json
# --verbose`, the prompt on stdin) with stream-json shaped as Claude Code's own: a system/init line, assistant
# messages with their id, model and usage, and a result line. It makes no network call. The prompt drives it:
#   @result <text>   the result's text (default: done)
#   @pad <n>         n assistant messages of filler text before the result, so the job's output is larger
use strict;
use warnings;
use JSON::PP;

my $VERSION = '__VERSION__';
my $MODEL = 'claude-haiku-4-5';
my $json = JSON::PP->new->canonical(1);
$| = 1;

if (grep { $_ eq '--version' || $_ eq '-v' } @ARGV) { print "$VERSION (Claude Code)\n"; exit 0; }
unless (grep { $_ eq '-p' || $_ eq '--print' } @ARGV) { print STDERR "stand-in claude: only headless runs (-p)\n"; exit 1; }

my $prompt = do { local $/; <STDIN> } // '';
my ($result) = $prompt =~ /^\@result (.*?)\s*$/m;
$result = 'done' unless defined $result;
my ($pad) = $prompt =~ /^\@pad (\d+)\s*$/m;
$pad = 0 unless defined $pad;

sub hex_of { my ($n) = @_; my $b = ''; if (open(my $r, '<', '/dev/urandom')) { read($r, $b, $n); close $r; } else { $b = pack('N*', map { int(rand(2**32)) } 1 .. $n); } return unpack('H*', substr($b, 0, $n)); }
sub uuid { my $h = hex_of(16); return join('-', substr($h, 0, 8), substr($h, 8, 4), '4' . substr($h, 13, 3), '8' . substr($h, 17, 3), substr($h, 20, 12)); }
sub out { print STDOUT $json->encode($_[0]), "\n"; }

my $session = uuid();
my %usage = (input_tokens => 0, cache_creation_input_tokens => 0, cache_read_input_tokens => 0, output_tokens => 0);
sub say_text {
  my ($text) = @_;
  my %u = (input_tokens => 12, cache_creation_input_tokens => 3, cache_read_input_tokens => 100, output_tokens => 7);
  $usage{$_} += $u{$_} for keys %u;
  out({ type => 'assistant', session_id => $session, parent_tool_use_id => undef, uuid => uuid(),
    message => { id => 'msg_' . hex_of(8), type => 'message', role => 'assistant', model => $MODEL, stop_reason => undef,
      content => [{ type => 'text', text => $text }], usage => \%u } });
}

out({ type => 'system', subtype => 'init', cwd => $ENV{PWD} // '', session_id => $session, model => $MODEL, tools => ['Read', 'Grep', 'Glob'],
  mcp_servers => [], permissionMode => 'dontAsk', apiKeySource => 'none', claude_code_version => $VERSION, uuid => uuid() });
say_text('stand-in: reading the prompt');
say_text('filler ' . ('x' x 200) . " $_") for 1 .. $pad;
out({ type => 'result', subtype => 'success', is_error => JSON::PP::false, duration_ms => 10, duration_api_ms => 5, num_turns => 1,
  result => $result, session_id => $session, total_cost_usd => 0.0042, usage => { %usage, service_tier => 'standard' }, permission_denials => [],
  modelUsage => { $MODEL => { inputTokens => $usage{input_tokens}, outputTokens => $usage{output_tokens}, costUSD => 0.0042 } }, uuid => uuid() });
exit 0;
