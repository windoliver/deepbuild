#!/usr/bin/perl
# The leased command (README, How ps waits are counted), installed as `leased-true` with the suite's folder written in
# for __DIR__: as `/usr/bin/true` in the issue's measurement, it exits 0 at once and starts nothing, so its process group
# ends with it. First it appends its PID, its parent's PID (`deep lease`'s: `nice` execs it) and when it started (ms
# since the epoch) to __DIR__/leased.log.
use strict;
use warnings;
use Time::HiRes qw(time);

my $dir = '__DIR__';
my $at = int(time() * 1000);
open(my $log, '>>', "$dir/leased.log") or die "leased-true: no log: $!";
print $log join("\t", $$, getppid(), $at), "\n";
close $log;
exit 0;
