import { randomInt } from 'node:crypto';
import { fail } from './http.js';

const MAX_DICE = 100;
const MAX_SIDES = 1000;

// Parses and rolls expressions like "1d20+5", "2d6 + 1d4 - 1", "d100".
// Rolling happens on the server so nobody can fake a result.
export function rollDice(input) {
  if (typeof input !== 'string') fail(400, 'Dice must be text like 1d20+5');
  const expr = input.replace(/\s+/g, '').toLowerCase();
  if (!expr || expr.length > 60) fail(400, 'Dice must be text like 1d20+5');
  const termRe = /([+-]?)(?:(\d*)d(\d+)|(\d+))/gy;
  const terms = [];
  let total = 0;
  let diceCount = 0;
  let m;
  while (termRe.lastIndex < expr.length && (m = termRe.exec(expr))) {
    if (terms.length && !m[1]) fail(400, `Couldn't read "${input}" — try something like 1d20+5`);
    const sign = m[1] === '-' ? -1 : 1;
    if (m[3] !== undefined) {
      const count = m[2] === '' ? 1 : Number(m[2]);
      const sides = Number(m[3]);
      if (count < 1 || sides < 2) fail(400, 'Dice need at least 1 die with 2 sides');
      diceCount += count;
      if (diceCount > MAX_DICE || sides > MAX_SIDES) fail(400, `At most ${MAX_DICE} dice with ${MAX_SIDES} sides`);
      const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
      const sum = rolls.reduce((a, b) => a + b, 0);
      terms.push({ sign, dice: `${count}d${sides}`, rolls });
      total += sign * sum;
    } else {
      const value = Number(m[4]);
      if (value > 100000) fail(400, 'Modifier is too large');
      terms.push({ sign, value });
      total += sign * value;
    }
  }
  if (!terms.length || termRe.lastIndex !== expr.length || !terms.some((t) => t.dice)) {
    fail(400, `Couldn't read "${input}" — try something like 1d20+5`);
  }
  return { expr, terms, total };
}
