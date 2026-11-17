// The playtest's codes in the check catalog, under the plug-in (Check input: playtest), each with its meaning and fix.
// playtest.not_live's subject and planted twin are #1046's; it is catalogued here so the kind's codes are whole.
// The bands, expectations and the play interface's codes are #555's; the soak's, rules.legal's and logic.edges' #1048's.

export const CODES = {
  'playtest.not_live': {
    meaning: 'The subject is a tour-only fallback, a video or a still, not the piece played live.',
    fix: 'Give the playtest the piece\'s document, or an export whose web player plays the document it holds.',
  },
  'playtest.stuck': {
    meaning: 'A run\'s measure moved less than its rule\'s amount for its rule\'s time before the run reached every goal.',
    fix: 'Open the frame at the step it was found stuck and the step it last moved, and let the player move on from there.',
  },
  'playtest.goal_missed': {
    meaning: 'No run reached a goal, or a run missed a goal that says each.',
    fix: 'Make the goal reachable from the start, by the route the bots take.',
  },
  'playtest.trap': {
    meaning: 'The piece\'s logic trapped in a run, as logic.trap reports it.',
    fix: 'Fix the item\'s step at the step named, with the entries that step read.',
  },
  'playtest.over_budget': {
    meaning: 'A step\'s logic fuel, the piece\'s own, passed the step ceiling for its budget class.',
    fix: 'Do less work a step, or spread it over steps, so the busiest step stays within its ceiling.',
  },
  'playtest.replay': {
    meaning: 'A run\'s recorded track, played again without its bot, didn\'t reach the same full-state hash.',
    fix: 'Make every input the run read an entry on its track: nothing the piece reads may come from outside it.',
  },
  'playtest.band': {
    meaning: 'The share of a bot\'s runs that reached a goal fell outside the band the brief gives it.',
    fix: 'Open the runs that missed (or reached) the goal against the band and change what decides it in the piece.',
  },
  'playtest.expect': {
    meaning: 'A run of a bot that must miss a goal reached it.',
    fix: 'Open the run at the step named: the game must not hand that goal to a player who plays that way.',
  },
  'play.missing': {
    meaning: 'The piece publishes no array, or one of the wrong type, for a name the play interface declares.',
    fix: 'Publish the named array as the interface locked in the brief declares it; the interface itself doesn\'t change.',
  },
  'play.out_of_range': {
    meaning: 'A published value of a name the play interface gives a range lay outside it, or a link named a cell off the grid.',
    fix: 'Keep the named value within its range at the step named, in the row named, and each link within the grid\'s cells.',
  },
  'playtest.soak': {
    meaning: 'In a soak\'s long run, a window\'s logic memory, save size or p99 step time passed the brief\'s limit.',
    fix: 'Open the window named: free what the piece keeps growing, or keep a step\'s work and a save within the limits.',
  },
  'rules.listed_refused': {
    meaning: 'A row the piece listed, put as its entry from a state a run reached, wasn\'t taken: accepted didn\'t rise, refused did, or nothing else changed.',
    fix: 'List only what the piece takes from that state, or take what it lists, at the run and step named.',
  },
  'rules.unlisted_taken': {
    meaning: 'An entry no listed row held, put from a state a run reached, was taken or changed a declared name instead of raising refused.',
    fix: 'Turn down every entry the piece doesn\'t list, at the run and step named, raising refused and changing nothing else.',
  },
  'logic.trap': {
    meaning: 'A control put at one of its kind\'s edge values, from a state a run reached, trapped the piece\'s logic.',
    fix: 'Play the track named and handle that value in the function and offset named, such as a zero divisor or an empty text.',
  },
  'logic.non_finite': {
    meaning: 'A control put at one of its kind\'s edge values wrote a NaN or an infinity to a declared array.',
    fix: 'Play the track named and keep the array named finite for that value.',
  },
} as const;
export type Code = keyof typeof CODES;
