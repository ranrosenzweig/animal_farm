// Checks the rules of movement under pressure:
//   node scripts/check.js
//
// Packs the pasture far past a comfortable stocking density, walks everyone
// for many rounds, and fails if any of these ever stops holding:
//   * no two animals stand closer than their radii allow
//   * nobody leaves the field
//   * nobody moves sideways or backward — every step lands within a turn's
//     worth of the direction the animal was already facing
//   * nobody covers more ground in one step than its stride
import Farm from "../src/model/Farm.js";
import { SPECIES } from "../src/model/species.js";
import { angleDifference, inBounds } from "../src/model/pasture.js";

// Deliberately more animals than the field can hold, so the check exercises
// both halves of the placement rule: the ones that fit, and the ones turned away.
const HERD = 90;
const ROUNDS = 200;
const EPSILON = 1e-9;

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
let widestTurn = 0;
for (let round = 1; round <= ROUNDS; round++) {
  // Where everyone stood, and which way they were pointed, before the round.
  const before = farm.animals.map((a) => ({ animal: a, x: a.x, y: a.y, facing: a.facing }));

  const { farm: next, moved } = farm.stepAll();
  farm = next;
  stepsTaken += moved;

  for (const was of before) {
    const { animal } = was;
    const dx = animal.x - was.x;
    const dy = animal.y - was.y;
    const travelled = Math.hypot(dx, dy);
    if (travelled < EPSILON) continue; // stayed put

    // It may turn up to turnRate before stepping, and shade the line by at
    // most one more turnRate to get past something. Nothing beyond that.
    const off = Math.abs(angleDifference(Math.atan2(dy, dx), was.facing));
    const allowed = 2 * animal.turnRate;
    widestTurn = Math.max(widestTurn, off);
    if (off > allowed + EPSILON) {
      fail(`round ${round}: ${animal.name} the ${animal.species} moved ${off.toFixed(2)} rad ` +
        `off its facing (may turn ${allowed.toFixed(2)})`);
    }
    if (travelled > animal.stepSize + EPSILON) {
      fail(`round ${round}: ${animal.name} covered ${travelled.toFixed(2)} in one step ` +
        `(stride ${animal.stepSize})`);
    }
  }

  audit(`round ${round}`);
}

const possible = farm.size * ROUNDS;
console.log(`Walked ${ROUNDS} rounds: ${stepsTaken}/${possible} steps found room ` +
  `(${((stepsTaken / possible) * 100).toFixed(0)}%); the rest were hemmed in.`);
console.log(`Sharpest step taken was ${widestTurn.toFixed(2)} rad off the animal's facing.`);

if (failures > 0) {
  console.error(`\n${failures} violation(s).`);
  process.exit(1);
}
console.log("\nOK — nobody overlapped, left the field, sidestepped, or outran its stride.");
