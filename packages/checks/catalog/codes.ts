// The catalog plug-in's codes in the check catalog, under the plug-in (Check input: catalog kinds), each with its
// meaning and fix.

export const CODES = {
  'catalog.ref_missing': {
    meaning: 'A ref or refs column names an ID its target table holds no row for.',
    fix: 'Add the row the ID names to its table, or correct the reference in the row and column named.',
  },
  'catalog.unreachable': {
    meaning: 'From the declared roots, no chain of recipes reaches the row named: for a recipe, the input or tool named comes from nothing reachable.',
    fix: 'Give the input named a source the roots reach, such as a drop, a loot entry or a recipe, or take the row out of what must be reachable.',
  },
  'catalog.gain_cycle': {
    meaning: 'A cycle of recipes, each made once, ends with more of the row named than it began with; or, with values, a recipe\'s outputs are worth more than its inputs by more than the margin.',
    fix: 'Change a recipe in the cycle named so it gives back no more than it takes, or bring the recipe named within its margin.',
  },
  'catalog.out_of_range': {
    meaning: 'A row\'s value lies outside the range the brief, the definition or the schema declares for its column.',
    fix: 'Bring the value of the row and column named within its range.',
  },
  'catalog.copy_missing': {
    meaning: 'A key a shown copy column holds has no entry in that column\'s copy table in one of the locales named.',
    fix: 'Write the copy for the key named in the locale named, in the copy table named.',
  },
  'catalog.dominant': {
    meaning: 'Over paired runs on one seed, the row named raises the goal\'s share past the limit, its 95% interval clear above it: it wins on its own.',
    fix: 'Weaken the row named, or give it a cost, until its with-run and without-run shares differ by less than the limit.',
  },
  'catalog.unpaired': {
    meaning: 'A pair of catalog.dominance\'s runs differs in more than the row\'s offers, played another catalog than the copy with its offers off, or doesn\'t replay from its track.',
    fix: 'Make the piece offer rows slot by slot from the catalog\'s offers column, so turning one row\'s offers off changes only that row\'s slots, and make its runs replay from their tracks.',
  },
  'scenario.unreachable': {
    meaning: 'From its start, no chain of trigger rows fires the goal named, or a reachable row shows a key with no copy.',
    fix: 'Make the trigger or condition named able to hold: a row that sets the flag, a path to the cells, a kind allowed to be built, or copy for the key.',
  },
} as const;
export type Code = keyof typeof CODES;
