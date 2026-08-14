// Checks the laws of the pasture under pressure:
//   node scripts/check.js
//
// Packs the pasture far past a comfortable stocking density, walks everyone
// for many rounds, and fails if any of these ever stops holding:
//   * no two animals stand closer than their radii allow
//   * nobody leaves the field, and nobody stands inside a rock
//   * every position and velocity stays a real number
//   * nobody travels faster than its own top speed — which is what stops a
//     collision from handing out energy the field never had
//   * every animal wants something a Mind could actually have chosen, every
//     drive stays a real 0..1 level, and a resting animal comes to a halt
//   * no resource is ever drawn below empty, and nothing dead stays on the field
//
// Two older rules are deliberately gone. Animals used to be forbidden from
// moving sideways or backward, and from covering more ground than their
// stride. Both were true of a body that teleported one stride per step and
// neither survives momentum: a chicken struck by a horse goes where the horse
// sent it, and a body running downhill outpaces its own legs. What replaces
// them is the speed cap, which is the physical version of the same worry.
import Farm from "../src/model/Farm.js";
import { SPECIES } from "../src/model/species.js";
import { inBounds } from "../src/model/pasture.js";
import { STEEPEST, rockPenetration } from "../src/model/terrain.js";
import { CONTACT_SLOP, GRAVITY, STOPPED } from "../src/model/physics.js";
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
    // Leaning on a rock is fine; being inside one is not. Same hair's breadth
    // the solver settles for, so resting against stone doesn't read as a fault.
    const inRock = rockPenetration(a, a.radius);
    if (inRock > CONTACT_SLOP) {
      fail(`${when}: ${a.name} is ${inRock.toFixed(2)} inside a rock at (${a.x.toFixed(1)}, ${a.y.toFixed(1)})`);
    }
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) {
      fail(`${when}: ${a.name} is at (${a.x}, ${a.y}) — the physics has come apart`);
    }
    if (!Number.isFinite(a.speed)) fail(`${when}: ${a.name} is travelling at ${a.speed}`);
    // Nothing may outrun its own top speed. A collision that handed out more
    // energy than went in would show up here first, as a body flung too fast.
    if (a.speed > a.topSpeed + EPSILON) {
      fail(`${when}: ${a.name} the ${a.species} is travelling ${a.speed.toFixed(2)} ` +
        `(top speed ${a.topSpeed.toFixed(2)})`);
    }
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
let fastest = { speed: 0, of: null };
let hardestShove = 0;
for (let round = 1; round <= ROUNDS; round++) {
  const before = farm.animals.map((a) => ({ animal: a, x: a.x, y: a.y }));

  const { farm: next, moved } = farm.stepAll();
  farm = next;
  stepsTaken += moved;
  for (const source of farm.resources) source.refill(source.capacity);

  for (const was of before) {
    const { animal } = was;
    if (animal.speed > fastest.speed) fastest = { speed: animal.speed, of: animal };
    // How far a body was carried beyond what its own legs could manage. Only
    // a collision or a slope can do that, and both are supposed to be able to.
    const travelled = Math.hypot(animal.x - was.x, animal.y - was.y);
    hardestShove = Math.max(hardestShove, travelled - animal.stepSize);
  }

  audit(`round ${round}`);
}

const possible = farm.size * ROUNDS;
console.log(`Walked ${ROUNDS} rounds: ${stepsTaken}/${possible} steps got somewhere ` +
  `(${((stepsTaken / possible) * 100).toFixed(0)}%); the rest were hemmed in.`);
if (fastest.of) {
  console.log(`Fastest anything travelled was ${fastest.speed.toFixed(2)} — ` +
    `${fastest.of.name} the ${fastest.of.species}, whose legs alone are worth ${fastest.of.stepSize}.`);
}
console.log(`Most any body was carried past its own cruising speed in one step: ` +
  `${Math.max(0, hardestShove).toFixed(2)} units.`);

// Resting: alone on the field, an animal told to rest must actually come to a
// halt and stay there. It coasts now rather than stopping dead — that is what
// having momentum means — but drag and the grip of the ground have to finish
// the job, and gravity must not walk it off down the hill afterwards.
{
  const sleeper = SPECIES[0].random();
  let quiet = new Farm("Resting").add(sleeper).farm;
  sleeper.mind = { cadence: Infinity, decide: () => ({ goal: "rest", reason: "told to" }) };
  sleeper.intention = { goal: "rest", reason: "told to" };

  let stoppedAfter = null;
  let drifted = 0;
  for (let step = 1; step <= 200; step++) {
    const { x, y } = sleeper;
    quiet = quiet.stepAll().farm;
    const shifted = Math.hypot(sleeper.x - x, sleeper.y - y);
    if (stoppedAfter === null && sleeper.speed === 0) stoppedAfter = step;
    if (stoppedAfter !== null) drifted = Math.max(drifted, shifted);
  }
  if (stoppedAfter === null) {
    fail(`resting: ${sleeper.name} never came to a stop in 200 steps of resting`);
  } else if (drifted > EPSILON) {
    fail(`resting: ${sleeper.name} stopped, then drifted ${drifted.toFixed(3)} — the ground is not holding it`);
  } else {
    console.log(`Resting: ${sleeper.name} the ${sleeper.species.toLowerCase()} coasted to a ` +
      `dead stop in ${stoppedAfter} steps and stayed put.`);
  }
}

// The steepest ground has to be climbable by the animal with the least to
// spare. If this fails, gravity is too strong for the relief and the slowest
// species will be stranded on a hillside rather than merely slowed by it.
{
  const slowest = SPECIES.reduce((worst, S) =>
    S.stepSize - GRAVITY * STEEPEST * (2.5 + S.mass / 160)
      < worst.stepSize - GRAVITY * STEEPEST * (2.5 + worst.mass / 160) ? S : worst);
  const uphill = slowest.stepSize - GRAVITY * STEEPEST * (2.5 + slowest.mass / 160);
  if (uphill <= STOPPED) {
    fail(`terrain: a ${slowest.species.toLowerCase()} makes ${uphill.toFixed(2)}/step up the ` +
      `steepest ground (${STEEPEST.toFixed(3)}) — it cannot climb it at all`);
  } else {
    console.log(`Climbing: the steepest ground is ${STEEPEST.toFixed(3)} rise per unit; a ` +
      `${slowest.species.toLowerCase()} still makes ${uphill.toFixed(2)}/step up it ` +
      `(${Math.round((uphill / slowest.stepSize) * 100)}% of its pace on the level).`);
  }
}

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
// One of each sex per pen, not two coin flips: `random()` picks a sex, so two
// of a species are a same-sex pair half the time and all six pens are once in
// sixty-four runs — which failed this check for want of a partner, not a bug.
for (const Species of SPECIES) {
  for (const sex of ["female", "male"]) {
    const animal = Species.random();
    animal.sex = sex;
    herd = herd.add(animal).farm;
  }
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
  "\nOK — nobody overlapped, left the field, stood in a rock, or outran its own\n" +
  "top speed; the resting stopped, the slowest can still climb the steepest\n" +
  "ground, and every animal wanted something real the whole way through."
);
