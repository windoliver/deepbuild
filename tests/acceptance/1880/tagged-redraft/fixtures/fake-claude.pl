#!/usr/bin/perl
# A fake `claude` for #1880's acceptance tests (README, Stand-ins). Perl, so it runs inside the runner's sandbox with
# nothing but /usr/bin. No network, no model. The test writes this file into the login PATH with its version
# placeholder replaced by a version Claude Code's facts cover.
#   --version    prints `<version> (Claude Code)`
#   auth status  prints {"loggedIn":true}: signed in, as Claude Code's own probe reads it
#   otherwise    a headless run: reads the prompt on stdin and prints stream-json: the init line, its argv as a `fake`
#                line (so the test reads which sub-agents and tools it was launched with), and a final result holding
#                an empty reading.answer@1
use strict;
use warnings;
use JSON::PP;

my $version = '__VERSION__';
my $json = JSON::PP->new->canonical(1);
if (@ARGV && $ARGV[0] eq '--version') { print "$version (Claude Code)\n"; exit 0; }
if (@ARGV >= 2 && $ARGV[0] eq 'auth' && $ARGV[1] eq 'status') { print $json->encode({ loggedIn => JSON::PP::true, authMethod => 'claude.ai' }), "\n"; exit 0; }
$| = 1;
my $stdin = do { local $/; <STDIN> } // '';
my $session = '00000000-0000-4000-8000-000000001880';
print $json->encode({ type => 'system', subtype => 'init', session_id => $session }), "\n";
print $json->encode({ type => 'fake', argv => [@ARGV], prompt_bytes => length($stdin) }), "\n";
print $json->encode({ type => 'result', subtype => 'success', is_error => JSON::PP::false, result => '{"findings":[]}', total_cost_usd => 0, session_id => $session }), "\n";
exit 0;
