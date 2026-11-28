// The playtest's codes in the check catalog, under the plug-in (Check input: playtest), each with its meaning and fix.
// playtest.not_live's subject and planted twin are #1046's; it is catalogued here so the kind's codes are whole.
// The bands, expectations and the play interface's codes are #555's; the soak's, rules.legal's and logic.edges' #1048's;
// grid.reach's #556's, with grid.same #3265's and grid.skipped #3263's.

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
  'grid.unreached': {
    meaning: 'On a floor a run generated, a goal or a cell of a class the brief lists can\'t be reached from the start, through doors and through locks whose keys are reached first.',
    fix: 'Open the floor of the run, seed and depth named, and join the cell named to the reached cell nearest it, or move a lock\'s key in front of it.',
  },
  'grid.skipped': {
    meaning: 'On a floor a run generated, a goal is still reached with every cell its need names closed: a route goes round the key, the bridge or the room the brief says the goal needs.',
    fix: 'Open the floor of the run, seed and depth named, and close the route named where it leaves the way the need names, so the goal is reached only through it.',
  },
  'grid.same': {
    meaning: 'Fewer of the floors the runs generated at a depth were distinct by hash than the share the brief gives differ: the generator repeats its floors from run to run.',
    fix: 'Generate every floor of the depth named from the run\'s own seed, so that runs of other seeds play other floors.',
  },
  'grid.flow': {
    meaning: 'A flow field, once its lag after the grid changed was over, led a cell up in cost, into a solid cell or round a loop, or left a spawn short of every target.',
    fix: 'Refresh the field within the lag after the grid changes, so each cell steps to an open neighbour of lower cost, at the run, step and cell named.',
  },
  // #851: a game shell's journeys (Check input: shell journeys).
  'shell.reads': {
    meaning: 'A level of a game shell reads or mirrors an array its own document doesn\'t hold, such as another level\'s.',
    fix: 'Read only the level\'s own arrays, and what an earlier level hands on through its carry record at step 0.',
  },
  'shell.unlock': {
    meaning: 'A level of a game shell was open before its turn: at the start beyond level 1, or past the next one when a level was completed.',
    fix: 'Open only level 1 at the start, and each next level when the one before it is completed.',
  },
  'shell.carry': {
    meaning: 'A level entered after the one before it was completed didn\'t start from that level\'s carry record.',
    fix: 'Give the earlier level\'s logic a carry and the later one a carry_in that accepts its layout, with the arrays named.',
  },
  'shell.pause': {
    meaning: 'A level paused and resumed reached a different full-state hash than a run never paused.',
    fix: 'Hold the level\'s clock and input while paused, so it continues from the step it was paused at.',
  },
  'shell.credits': {
    meaning: 'The credits screen\'s roll never reached its end, or back never left it.',
    fix: 'Give the credits screen its end step and a way back.',
  },
  'shell.device': {
    meaning: 'A journey couldn\'t be finished with one device alone, or its runs with keys, a pad and touches ended on different full-state hashes.',
    fix: 'Make the control named work from that device: keys and a pad move focus and adjust, touches tap; nothing may need a pointer drag alone.',
  },
  'shell.back': {
    meaning: 'From a screen, back pressed again and again didn\'t reach the title within 3 presses, or from a level it left without showing pause.',
    fix: 'Give the screen named a way back to the screen that opened it, and send back in a level to pause first.',
  },
  'shell.focus': {
    meaning: 'After a key or pad input on a screen, focus wasn\'t on exactly one enabled control at a step.',
    fix: 'Hand focus to the next enabled control the step the focused one is disabled.',
  },
  'prompt.agree': {
    meaning: 'A prompt on a shell screen didn\'t show the glyph of the device that wrote the last entry by the next step.',
    fix: 'Draw the prompt named from the device that wrote last, never from one device\'s labels.',
  },
  'ui.layout': {
    meaning: 'On a shell screen at a size, two controls overlap past 1 px, a control\'s text runs outside it, a control lies outside the frame or one is under 24 × 24 px.',
    fix: 'Move or size the items named on the screen named so each control fits the frame, keeps its text and leaves the others clear.',
  },
  'wired': {
    meaning: 'A control a shell screen lists as enabled changed neither the full-state hash nor the screen within its step budget once activated.',
    fix: 'Bind the control named to what it says it does, or disable it.',
  },
} as const;
export type Code = keyof typeof CODES;
