#!/usr/bin/perl
# A stand-in for a heavy command (README, How commands are stood in for): installed as `cargo`, `npx`, `kit-run`,
# `gpu-export`, `build-block` and `spawner` on the PATH the sessions' commands get, with the suite's folder written in
# for __DIR__ when it is installed, so it needs nothing from the environment it is run with. It marks its start
# (`S`) and end (`E`) in __DIR__/log with its label (DH1015_LABEL, else its folder's name), its PID, the time in
# milliseconds and how it was called, prints a line or two as a test runner does, and runs until __DIR__/go/<label>
# or __DIR__/go/all exists. As `spawner` it starts a child in its own process group, its output closed, which runs
# until that go file; marks `P <label> <its pid> <the child's pid> <the group>`, and exits at once.
use strict;
use warnings;
use Time::HiRes qw(time sleep);
use Cwd qw(getcwd);
use File::Basename qw(basename);

my $dir = '__DIR__';
my $label = $ENV{DH1015_LABEL} // basename(getcwd());
my $what = join(' ', basename($0), @ARGV);
sub mark { open(my $log, '>>', "$dir/log") or die "no log: $!"; print $log join("\t", @_), "\n"; close $log; }
sub stamp { mark($_[0], $label, $$, int(time() * 1000), $what); }
sub until_go { until (-e "$dir/go/$label" || -e "$dir/go/all") { sleep 0.05; } }
$| = 1;
stamp('S');
print "$what: running in $label\n";
if (basename($0) eq 'spawner') {
  my $child = fork();
  die "fork: $!" unless defined $child;
  if ($child == 0) {
    open(STDOUT, '>', '/dev/null');
    open(STDERR, '>', '/dev/null');
    $what = "$what (child)";
    until_go();
    stamp('E');
    exit 0;
  }
  mark('P', $label, $$, $child, getpgrp());
  exit 0;
}
until_go();
stamp('E');
print "test result: ok. 1 passed; 0 failed\n";
exit 0;
