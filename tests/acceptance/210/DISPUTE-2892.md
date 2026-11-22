# Dispute under #2892: criterion 6 (`ac6-web-export.test.ts`), its search of the bundle for the port's plug-in

#2892 stores the bundle's document, track and other files whose format doesn't compress its own data as gzip. The first
test here searches each file's stored bytes for the plug-in's ID, so a port written into a gzip-stored document would
pass it unseen. It still passes on the right program; it stops seeing what it searches for.

That assertion went to a blind redraft, `tests/acceptance/210-redraft-2892/`, which searches each file as the page
reads it (inflated where stored gzip) and keeps the rest of the test through the first draft's helpers. It runs in this
file's place (`scripts/lanes.mjs`), and this file moves to the by-hand list. Its second test, the planted
`web_export_keeps_port` failing the export's read-back, reads no bundle byte and holds under #2892; it runs by hand with
this file until you rule on the swap.
