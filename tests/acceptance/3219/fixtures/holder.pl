#!/usr/bin/perl
# A stand-in for a command that holds the GPU under `deep lease` (README: The surface under test), adapted from
# tests/acceptance/1015/fixtures/standin.pl (same repo, same license): installed as `holder` in the world's bin folder with
# the world's folder written in for __DIR__. `holder <label>` says it holds, then runs until __DIR__/go/<label> or
# __DIR__/go/all exists, checking every 50 ms (this program is the fixture's holder, not a test's wait).
use strict;
use warnings;
use Time::HiRes qw(sleep);

my $dir = '__DIR__';
my $label = $ARGV[0] // 'holder';
$| = 1;
print "holder $label: holding\n";
until (-e "$dir/go/$label" || -e "$dir/go/all") { sleep 0.05; }
print "holder $label: let go\n";
exit 0;
