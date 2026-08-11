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
//   * every animal wants something a Mind could actually have chosen, every
//     drive stays a real 0..1 level, and an animal that chose to stay put did
//   * no resource is ever drawn below empty, and nothing dead stays on the field
import Farm from "../src/model/Farm.js";
import { SPECIES } from "../src/model/species.js";
import { angleDifference, inBounds } from "../src/model/pasture.js";
import { GOAL_NAMES } from "../src/model/goals.js";
import { DRIVES } from "../src/model/drives.js";
import Resource from "../src/model/Resource.js";

// Deliberately more animals than the field can hold, so the check exercises
// both halves of the placement rule: the ones that fit, and the ones turned away.
const HERD = 90;
const ROUNDS = 200;
const EPSILON = 1e-9;

// Well watered and well grassed, and topped back up every round below. This
// half of the check is about movement under crowding, so nothing here should
// die of thirst part way through and thin the herd. Famine gets its own test.
let farm = new Farm("Stress Test", [], [
  new Resource("water", { x: 15, y: 25 }), new Resource("water", { x: 15, y: 68 }),
  new Resource("water", { x: 80, y: 25 }), new Resource("water", { x: 80, y: 68 }),
  new Resource("grass", { x: 35, y: 45 }), new Resource("grass", { x: 62, y: 45 }),
  new Resource("grass", { x: 48, y: 20 }), new Resource("grass", { x: 48, y: 72 }),
]);
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
    if (!GOAL_NAMES.includes(a.goal)) fail(`${when}: ${a.name} wants "${a.goal}", which is not a goal`);
    for (const drive of DRIVES) {
      const level = a.drives[drive];
      if (!(level >= 0 && level <= 1)) fail(`${when}: ${a.name}'s ${drive} is ${level}`);
    }
    if (!(a.health > 0)) fail(`${when}: ${a.name} is still on the field at ${a.health} condition`);
    if (a.isPregnant && a.sex !== "female") fail(`${when}: ${a.name} is ${a.sex} and carrying young`);
    if (a.isPregnant && !a.isAdult) fail(`${when}: ${a.name} is a newborn and carrying young`);
  }
  for (const r of farm.resources) {
    if (r.volume < 0) fail(`${when}: ${r.name} has been drawn to ${r.volume}`);
    if (r.volume > r.capacity) fail(`${when}: ${r.name} holds ${r.volume} of ${r.capacity}`);
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
  for (const source of farm.resources) source.refill(source.capacity);

  for (const was of before) {
    const { animal } = was;
    const dx = animal.x - was.x;
    const dy = animal.y - was.y;
    const travelled = Math.hypot(dx, dy);

    // An animal pursuing a goal it performs by standing still must not have moved.
    if (animal.isStill() && travelled > EPSILON) {
      fail(`round ${round}: ${animal.name} is ${animal.goal}ing but moved ${travelled.toFixed(2)}`);
    }
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

// Famine: with nothing in the field at all, every animal must eventually die
// and leave it. An animal that survives on an empty farm is a broken model.
let bare = new Farm("Famine");
for (const Species of SPECIES) bare = bare.add(Species.random()).farm;
const startedWith = bare.size;
let buried = 0;
let famineRounds = 0;
const causes = new Set();
while (bare.size > 0 && famineRounds < 5000) {
  const { farm: next, died } = bare.stepAll();
  bare = next;
  buried += died.length;
  for (const animal of died) causes.add(animal.endedBy);
  famineRounds += 1;
}
if (bare.size > 0) {
  fail(`famine: ${bare.size} animals still alive after ${famineRounds} rounds with no water or grass`);
} else {
  console.log(`Famine: all ${buried} of ${startedWith} animals died within ${famineRounds} rounds ` +
    `on an empty field (of ${[...causes].join(" and ")}).`);
}

// Breeding: a pair must produce young of their own species, and nothing else.
// Well supplied and topped up, so this measures breeding and not starvation.
let herd = new Farm("Breeding", [], [
  new Resource("water", { x: 15, y: 25 }), new Resource("water", { x: 80, y: 68 }),
  new Resource("grass", { x: 35, y: 45 }), new Resource("grass", { x: 62, y: 45 }),
]);
for (const Species of SPECIES) {
  for (let i = 0; i < 2; i++) herd = herd.add(Species.random()).farm;
}
let calved = 0;
for (let round = 1; round <= 1500; round++) {
  const { farm: next, born } = herd.stepAll();
  herd = next;
  for (const source of herd.resources) source.refill(source.capacity);
  for (const baby of born) {
    calved += 1;
    if (baby.species !== baby.parents.species) {
      fail(`breeding: a ${baby.parents.species} gave birth to a ${baby.species}`);
    }
    if (baby.age !== 0) fail(`breeding: ${baby.name} was born aged ${baby.age}`);
  }
  for (const [a, b] of herd.overlaps()) {
    fail(`breeding round ${round}: ${a.name} overlaps ${b.name}`);
  }
}
if (calved === 0) {
  fail("breeding: 1500 rounds with pairs of every species and not one birth");
} else {
  console.log(`Breeding: ${calved} born over 1500 rounds, every one its mother's species.`);
}

if (failures > 0) {
  console.error(`\n${failures} violation(s).`);
  process.exit(1);
}
console.log(
  "\nOK — nobody overlapped, left the field, sidestepped, or outran its stride,\n" +
  "and every animal wanted something real the whole way through."
);
