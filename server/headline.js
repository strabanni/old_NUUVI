// The big line before a character's name on their profile ("OHH SHIT IT'S, AEDAN!"). It changes
// over time, always with the same energy as the line their writer chose: a hyped line stays hyped,
// a smug one stays smug. These are the built-in sets; with Claude switched on, it writes new ones
// in the writer's own voice (see profiles.js).
const ENERGIES = {
  hype: ["OHH SHIT IT'S", "HOLY SHIT IT'S", "AYO IT'S", "NO WAY IT'S", "BRO IT'S LITERALLY", "STOP EVERYTHING IT'S",
    "OMG IT'S", "YOOO IT'S", "WAIT WAIT WAIT IT'S", "DAMN IT'S"],
  smug: ['LOOK WHO IT IS', "WELL WELL WELL IT'S", "GUESS WHO IT'S", "OH IT'S JUST", 'IN THE FLESH', 'BACK AGAIN',
    'THE ONE AND ONLY', "OF COURSE IT'S", 'LOOK WHO SHOWED UP'],
  warm: ["HEY IT'S", "HI THERE IT'S", "OH HELLO IT'S", 'SAY HI TO', "LOOK IT'S", "AWW IT'S", "HEY HEY IT'S", 'WELCOME BACK'],
  dark: ["DON'T LOOK NOW IT'S", "QUIET IT'S", 'SPEAK OF THE DEVIL', "BEHIND YOU IT'S", 'IT WAS ALWAYS', "SHH IT'S", 'BEWARE'],
  plain: ["IT'S", 'THIS IS', 'MEET', "HERE'S", 'INTRODUCING', 'PRESENTING', "YEP IT'S"],
};
const MOODS = [
  ['hype', /\b(shit|damn|fuck|hell|holy|omg|ayo+|yo+|bro|no way|wtf|lets go|let's go|stop)\b|!{1,}/i],
  ['smug', /\b(look who|well well|guess who|just|again|of course|the one|flesh|showed up)\b/i],
  ['dark', /\b(devil|behind|quiet|beware|shh+|don't look|dont look|always|watch out|run)\b/i],
  ['warm', /\b(hi|hey|hello|welcome|aww+|sweet|love|say hi|cutie)\b/i],
];
export function energyOf(line = '') {
  const t = String(line);
  return MOODS.find(([, re]) => re.test(t))?.[0] ?? 'plain';
}
// The writer's own line first, then others with the same energy.
export function headlineSet(line = '') {
  const own = String(line || '').trim().toUpperCase();
  const pool = ENERGIES[energyOf(line)];
  return [...new Set([own || "IT'S", ...pool])].slice(0, 10);
}
