// #1426, wrong script: merge takes the new release whole, dropping what we carry.
import { main } from './rebase-base.mjs';

main({ takeTheirs: true });
