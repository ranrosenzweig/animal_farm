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
import { seed } from "../src/model/random.js";
import Farm from "../src/model/Farm.js";
import { SPECIES, Human, speciesNamed } from "../src/model/species.js";
import { PASTURE, inBounds } from "../src/model/pasture.js";
import { OBSTACLES, STEEPEST, obstaclePenetration } from "../src/model/terrain.js";
import { CONTACT_SLOP, GRAVITY, STOPPED, responseTime } from "../src/model/physics.js";
import { GOAL_NAMES } from "../src/model/goals.js";
import { DRIVES } from "../src/model/drives.js";
import Resource, { DEEP, ENOUGH, setHeldLevels } from "../src/model/Resource.js";

// A different farm every run, but never an unrepeatable one. The check earns
// its keep by exploring trajectories a fixed seed would never reach — it has
// caught overlaps that only appear in one crowd out of six — and a failure
// nobody can reproduce is a failure nobody fixes. So: draw a seed, say which,
// and take it back from SEED= to replay that exact run.
const SEED = Number(process.env.SEED ?? Date.now() % 2 ** 31);
seed(SEED);
console.log(`Seed ${SEED} — rerun this exact farm with SEED=${SEED} npm run check`);

// Deliberately more animals than the field can hold, so the check exercises
// both halves of the placement rule: the ones that fit, and the ones turned away.
const HERD = 90;
const ROUNDS = 200;
const EPSILON = 1e-9;

// How far a pool may close over a body standing on its rim before that counts
// as the body being in the water. Not the usual `CONTACT_SLOP`, because a pool
// breathes: a herd drinks it down, rain and the top-up below swell it again,
// and water that rises around planted feet catches them for the one round it
// takes the solver to put them back on the bank. A unit is the rim. Walking
// across a pond would show up here as several.
const RISE = 1;

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
  const pools = farm.pools();
  for (const [a, b] of farm.overlaps()) {
    fail(`${when}: ${a.name} the ${a.species} overlaps ${b.name} the ${b.species}`);
  }
  for (const a of farm.animals) {
    if (!inBounds(a)) fail(`${when}: ${a.name} is outside the fence at (${a.x}, ${a.y})`);
    // Leaning on a rock or a wall is fine; being inside one is not. Same hair's
    // breadth the solver settles for, so resting against stone doesn't read as
    // a fault.
    const inSolid = obstaclePenetration(a, a.radius);
    if (inSolid > CONTACT_SLOP) {
      fail(`${when}: ${a.name} is ${inSolid.toFixed(2)} inside solid ground at (${a.x.toFixed(1)}, ${a.y.toFixed(1)})`);
    }
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) {
      fail(`${when}: ${a.name} is at (${a.x}, ${a.y}) — the physics has come apart`);
    }
    // Water is a body too, for everything that cannot swim. Wading to the rim
    // to drink is the point; standing out of its depth is not.
    for (const pool of a.constructor.swims ? [] : pools) {
      // Water stops feet, so this is the animal's middle against the line where
      // the pond gets too deep — not its whole body, which is wading.
      const under = pool.radius - Math.hypot(a.x - pool.x, a.y - pool.y);
      if (under > RISE) {
        fail(`${when}: ${a.name} the ${a.species} is ${under.toFixed(2)} into deep water ` +
          `at (${a.x.toFixed(1)}, ${a.y.toFixed(1)})`);
      }
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

// The gap between a solid patch and the fence must be wide enough for the
// biggest animal, or not exist at all. A pocket narrower than an animal has no
// legal ground in it, and anything that wandered in would be shoved off the
// rail and out of the stone turn about until the solver gave up — taking every
// overlap near it down with it. A wall standing *across* the rail is fine:
// there is nothing behind it to be trapped in, which is how the barn gets to
// sit in the corner. Cheap to check, and invisible until something large walks
// into the gap.
{
  const widest = SPECIES.reduce((w, S) => Math.max(w, S.radius), 0);
  for (const solid of OBSTACLES) {
    // How much walkable ground each side leaves between the patch and the rail.
    const gaps = [
      ["the west fence", solid.x - solid.radius - PASTURE.minX],
      ["the east fence", PASTURE.maxX - solid.x - solid.radius],
      ["the north fence", solid.y - solid.radius - PASTURE.minY],
      ["the south fence", PASTURE.maxY - solid.y - solid.radius],
    ];
    for (const [which, gap] of gaps.filter(([, g]) => g > 0 && g < widest)) {
      fail(`terrain: the ${solid.ground} at (${solid.x}, ${solid.y}) leaves a ${gap.toFixed(1)}-wide ` +
        `pocket against ${which} — too narrow for a ${widest}-radius animal to stand in`);
    }
  }
  if (failures === 0) {
    console.log(`Obstacles: all ${OBSTACLES.length} either stand clear of the fence for the widest ` +
      `animal (radius ${widest}) or reach across it.`);
  }
}

// The steepest ground has to be climbable by the animal with the least to
// spare. If this fails, gravity is too strong for the relief and the slowest
// species will be stranded on a hillside rather than merely slowed by it.
{
  const climbRate = (S) => S.stepSize - GRAVITY * STEEPEST * responseTime(S.mass);
  const slowest = SPECIES.reduce((worst, S) => climbRate(S) < climbRate(worst) ? S : worst);
  const uphill = climbRate(slowest);
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
//
// The farmer is deliberately left out, and that is the whole of what he is:
// he carries hay and water out of the barn, so a field that is bare of
// everything except him is not a field with nothing in it. What he can do with
// that is tested on its own below.
const HERDING = SPECIES.filter((Species) => Species !== Human);
let bare = new Farm("Famine");
for (const Species of HERDING) bare = bare.add(Species.random()).farm;
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

// Tending: the same bare field, with Old MacDonald standing on it. The herd
// that died above has to still be a herd — he sows a fresh source when a kind
// runs out and fills it from the barn, so the field must have both kinds on it
// and something alive to drink them. Deliberately not a promise that nobody
// dies: he can only be in one place, and an animal that will not walk to water
// is not his fault.
{
  let kept = new Farm("Tending");
  for (const Species of SPECIES) kept = kept.add(Species.random()).farm;
  for (let round = 1; round <= 600; round++) kept = kept.stepAll().farm;

  const farmer = kept.animals.find((a) => a instanceof Human);
  const herd = kept.size - (farmer ? 1 : 0);
  const bareOf = kept.stock().filter((s) => s.sources === 0 || s.volume <= 0);
  if (!farmer) fail("tending: Old MacDonald did not survive 600 rounds of his own farm");
  if (herd === 0) fail("tending: the whole herd died in 600 rounds with the farmer on the field");
  // Every drop of this was carried out of the barn: the field started with
  // nothing on it, so a source standing here at all is one he put down.
  for (const s of bareOf) fail(`tending: 600 rounds in and the field has no ${s.kind} on it at all`);
  if (failures === 0) {
    console.log(`Tending: 600 rounds on a field that started bare — ${herd} of ${SPECIES.length - 1} still ` +
      `alive, ${Math.round(farmer.stores)} of ${Human.stores} left in the barn, ` +
      `field holding ${kept.stock().map((s) => `${s.volume} ${s.unit} of ${s.kind}`).join(" and ")}.`);
  }
}

// The implements: grass is cut and carted, water is piped, and both live at the
// house. One farmer, one low pond, one bare patch and nothing drinking, so
// every drop that moves here is his — and he cannot move both without walking
// home in between, which is the constraint being measured. He has to finish the
// pair.
{
  let shed = new Farm("Implements", [], [
    new Resource("water", { x: 17, y: 68 }, { name: "Pond", volume: 10 }),
    new Resource("grass", { x: 34, y: 30 }, { name: "Meadow", volume: 6 }),
  ]);
  shed = shed.add(Human.random()).farm;
  const hand = shed.animals[0];
  // Long enough for both jobs with a night's sleep in the middle of them and
  // room to spare: he sleeps through half of any stretch of rounds, and where
  // he happens to start costs him a walk either way.
  for (let round = 1; round <= 900; round++) shed = shed.stepAll().farm;

  const short = shed.resources.filter((r) => r.fullness < ENOUGH);
  for (const kind of ["water", "grass"]) {
    if (!(hand.carried[kind] > 0)) {
      fail(`implements: 900 rounds and he never put any ${kind} down — ` +
        `he is holding the ${hand.tool ?? "nothing"}, so the other job never got its turn`);
    }
  }
  for (const r of short) {
    fail(`implements: ${r.name} is still at ${Math.round(r.volume)} of ${r.capacity} — ` +
      "he left a job unfinished");
  }
  if (failures === 0) {
    console.log(`Implements: alone with a low pond and a bare patch, he fetched both — ` +
      `${Math.round(hand.carried.water)} L by hose and ${Math.round(hand.carried.grass)} kg by tractor, ` +
      `leaving ${shed.resources.map((r) => `${r.name} at ${Math.round(r.fullness * 100)}%`).join(" and ")}.`);
  }
}

// The squeeze: a gap narrower than the two animals in it.
//
// Bessie stands with her middle on the east pond's deep line and Nugget on the
// rock at (55, 29), both on the line between rock and pond, with 9.1 units of
// gap for 10 units of animal. Prising them apart along the line between their
// centres pushes each straight into the thing behind it, which puts each
// straight back: the overlap does not change by so much as a rounding error,
// and 2000 passes leave the field exactly as they found it. This is the shape
// of the round-114 jam from SEED=73 of the old stress run, laid out by hand
// rather than replayed — seeds renumber whenever the model changes, and it is
// the geometry that is the bug.
const wedged = new Farm("Wedged", [], [new Resource("water", { x: 80, y: 25 })]);
const rock = OBSTACLES[0];
const pond = wedged.resources[0];
const span = Math.hypot(pond.x - rock.x, pond.y - rock.y);
const along = { x: (pond.x - rock.x) / span, y: (pond.y - rock.y) / span };
for (const [name, species, from, out] of [
  // Each one exactly touching its own barrier: the chicken's is the rock, and
  // the cow's is the deep water, which the solver sees shrunk by her own radius.
  ["Nugget", "Chicken", rock, rock.radius + 4.5],
  ["Bessie", "Cow", pond, -pond.radius * DEEP],
]) {
  const animal = new (speciesNamed(species))(name);
  animal.age = 1;   // grown, so the radii are the ones that made the jam
  animal.moveTo({ x: from.x + along.x * out, y: from.y + along.y * out });
  wedged.animals.push(animal);
}
const spent = wedged.resolve();
const stuck = wedged.overlaps();
if (stuck.length) {
  const [a, b] = stuck[0];
  fail(`squeeze: ${spent} passes and ${a.name} is still standing in ${b.name} — ` +
    "prising along the line between them cannot solve a gap narrower than the pair");
} else {
  console.log(`Squeeze: a cow wedged between the water and a chicken on a rock ` +
    `came apart in ${spent} passes.`);
}

// Held levels: the opposite of famine. What is held is the reading, not the
// supply, so a held source pays a full mouthful whatever it says — even empty
// — and never hides itself from the drink goal. The old bug served a mouthful
// the size of what was left, which meant a herd dying of thirst beside a pond
// whose level obligingly never fell.
setHeldLevels(true);
const puddle = new Resource("water", { x: 15, y: 25 }, { volume: 0 });
if (puddle.draw(1.1) !== 1.1) fail("held: an empty held pond served a short drink");
if (puddle.volume !== 0) fail(`held: the reading moved to ${puddle.volume}`);
if (puddle.depleted) fail("held: an empty held pond hid itself from the drink goal");
if (puddle.refill(50) !== 0 || puddle.volume !== 0) fail("held: a held pond took a top-up");
// Width is not decoration: an animal drinks by standing in it, so a held pond
// drawn as a puddle is a pond only the small animals can queue at.
if (puddle.radius !== puddle.spec.spread) {
  fail(`held: an empty held pond spreads ${puddle.radius.toFixed(2)}, not the full ` +
    `${puddle.spec.spread} — too small for a cow to get her nose in beside a duck`);
}

// And end to end: a herd drinking and grazing for a long time must not move
// the reading by a drop. Deliberately not asserted on who survives — holding
// the levels is not a promise that nothing ever dies. An animal still has to
// walk to the water, still gives way at a crowded trough, and still follows
// whichever drive is loudest, so a chicken whose hunger outruns its thirst can
// die parched with a full pond across the field. That is the mind's business,
// not the trough's.
let pinned = new Farm("Held", [], [
  new Resource("water", { x: 15, y: 25 }, { volume: 50 }),
  new Resource("grass", { x: 35, y: 45 }, { volume: 30 }),
]);
for (const Species of SPECIES) pinned = pinned.add(Species.random()).farm;
const pinnedHerd = pinned.size;
const levels = pinned.resources.map((r) => r.volume);
for (let round = 1; round <= 1200; round++) pinned = pinned.stepAll().farm;
if (pinned.resources.some((r, i) => r.volume !== levels[i])) {
  fail(`held: levels moved — ${pinned.resources.map((r) => r.volume).join(", ")} against ${levels.join(", ")}`);
}
setHeldLevels(false);
console.log(`Held levels: ${pinnedHerd} animals drank and grazed for 1200 rounds and left the ` +
  `field reading ${levels.join(" and ")}, exactly as it started (${pinned.size} still alive).`);

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
  console.error(`\n${failures} violation(s). Reproduce with: SEED=${SEED} npm run check`);
  process.exit(1);
}
console.log(
  "\nOK — nobody overlapped, left the field, stood in a rock, or outran its own\n" +
  "top speed; the resting stopped, the slowest can still climb the steepest\n" +
  "ground, and every animal wanted something real the whole way through."
);
