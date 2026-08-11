// Checks the rule that no animal may stand on another, under pressure:
//   node scripts/check.js
//
// Packs the pasture far past a comfortable stocking density, walks everyone
// for many rounds, and fails if two animals are ever closer than their radii
// allow or if anyone steps outside the fence.
import Farm from "../src/model/Farm.js";
import { SPECIES } from "../src/model/species.js";
import { inBounds } from "../src/model/pasture.js";

// Deliberately more animals than the field can hold, so the check exercises
// both halves of the rule: the ones that fit, and the ones turned away.
const HERD = 90;
const ROUNDS = 200;

let farm = new Farm("Stress Test");
let turnedAway = 0;
for (let i = 0; i < HERD; i++) {
  const { farm: next, added } = farm.add(SPECIES[i % SPECIES.length].random());
  farm = next;
  if (!added) turnedAway++;
}

let failures = 0;
const fail = (msg) => { console.error(`  FAIL ${msg}`); failures++; };

const audit = (when) => {
  for (const [a, b] of farm.overlaps()) {
    fail(`${when}: ${a.name} the ${a.species} overlaps ${b.name} the ${b.species}`);
  }
  for (const a of farm.animals) {
    if (!inBounds(a)) fail(`${when}: ${a.name} is outside the fence at (${a.x}, ${a.y})`);
  }
};

console.log(`Placed ${farm.size} of ${HERD} animals; ${turnedAway} turned away for lack of room.`);
audit("on placement");

let stepsTaken = 0;
for (let round = 1; round <= ROUNDS; round++) {
  const { farm: next, moved } = farm.stepAll();
  farm = next;
  stepsTaken += moved;
  audit(`round ${round}`);
}

const possible = farm.size * ROUNDS;
console.log(`Walked ${ROUNDS} rounds: ${stepsTaken}/${possible} steps found room ` +
  `(${((stepsTaken / possible) * 100).toFixed(0)}%); the rest were hemmed in.`);

if (failures > 0) {
  console.error(`\n${failures} violation(s).`);
  process.exit(1);
}
console.log("\nOK — no animal ever stood on another, and none left the field.");
