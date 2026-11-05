#!/usr/bin/perl
# A fake `codex` for #39's tests (README, The fake CLI). Perl, as tests/acceptance/159/fixtures/fake-claude.pl, so it runs
# inside the runner's sandbox. `--version`; `login status`, which prints a secret-shaped line as Codex does with an API
# key and exits with the configured code; `exec --json ... -`, the prompt on stdin, printing Codex's JSON events: a
# thread.started, a report of its argv and stdin, what the prompt's @ lines ask, turn.completed. It models the sandbox from
# its flags alone: `-s read-only` refuses a write. Its own rollout goes under $HOME/.codex/sessions.
use strict;
use warnings;
use JSON::PP;
use MIME::Base64 qw(encode_base64);
use File::Basename qw(dirname);
use File::Path qw(make_path);
use Cwd qw(getcwd abs_path);
use Time::HiRes qw(sleep);

my $here = dirname(abs_path($0));
my $conf = {};
if (open(my $c, '<', "$here/fake-codex.json")) { local $/; $conf = decode_json(<$c>); close $c; }
my $json = JSON::PP->new->canonical(1);
sub say_line { print $json->encode($_[0]), "\n"; }
if ($conf->{log} && open(my $l, '>>', $conf->{log})) { print $l join(' ', @ARGV), "\n"; close $l; }
my $version = $conf->{version} // '0.160.0';
if (@ARGV && $ARGV[0] eq '--version') { print "codex-cli $version\n"; exit 0; }
if (@ARGV >= 2 && $ARGV[0] eq 'login' && $ARGV[1] eq 'status') {
  my $secret = $conf->{secret} // 'sk-proj-dh39FAKEprintedbylogin0000000000';
  print "Logged in using an API key - $secret\n"; print STDERR "$secret\n";
  exit($conf->{loginExit} // 0);
}
if (@ARGV && $ARGV[0] eq 'app-server') { exit 0; }
exit 2 unless @ARGV && $ARGV[0] eq 'exec';
$| = 1;
my $stdin = do { local $/; <STDIN> } // '';
my %flag; for my $i (0 .. $#ARGV - 1) { $flag{$ARGV[$i]} = $ARGV[$i + 1]; }
my $thread = $stdin =~ /^\@session (\S+)/m ? $1 : sprintf('019a0000-0000-7000-8000-%012x', int(rand(2**40)));
say_line({ type => 'thread.started', thread_id => $thread });
say_line({ type => 'turn.started' });
say_line({ type => 'item.completed', item => { id => 'item_0', type => 'agent_message', text => 'fake:' . $json->encode({ cmd => 'start', argv => [@ARGV], cwd => getcwd(), stdin => encode_base64($stdin, '') }) } });
my $rollout = "$ENV{HOME}/.codex/sessions";
make_path($rollout);
if (open(my $r, '>', "$rollout/rollout-$thread.jsonl")) { print $r $json->encode({ type => 'session_meta', payload => { id => $thread, cwd => getcwd(), cli_version => $version } }), "\n"; print $r $json->encode({ type => 'response_item', payload => { type => 'message', role => 'user', content => [{ type => 'input_text', text => $stdin }] } }), "\n"; close $r; }
my $n = 1;
for my $line (split /\n/, $stdin) {
  if ($line =~ /^\@sleep (\d+)/) { sleep($1 / 1000); }
  elsif ($line =~ /^\@write (\S+) (.*)$/) {
    my ($rel, $text) = ($1, $2);
    if (($flag{'-s'} // '') eq 'read-only') {
      say_line({ type => 'item.completed', item => { id => 'item_' . $n++, type => 'command_execution', command => "/bin/sh -c 'printf x > $rel'", aggregated_output => "/bin/sh: $rel: Operation not permitted\n", exit_code => 1, status => 'failed' } });
    } else {
      open(my $w, '>', $rel) or die; print $w "$text\n"; close $w;
      say_line({ type => 'item.completed', item => { id => 'item_' . $n++, type => 'file_change', changes => [{ path => $rel, kind => 'add' }], status => 'completed' } });
    }
  }
}
say_line({ type => 'item.completed', item => { id => 'item_' . $n++, type => 'agent_message', text => 'Finished.' } });
say_line({ type => 'turn.completed', usage => { input_tokens => 10, cached_input_tokens => 2, output_tokens => 3 } });
exit 0;
