// Runs the farm for a long time and reports on how it behaved:
//
//   npm run probe                                  800 steps, one of each species
//   npm run probe -- --steps 2000 --herd 3         a bigger herd, longer run
//   npm run probe -- --stocked                     top the sources up every round
//
// Balance problems do not show up in a twenty-step run. Drives cycle over
// hundreds of steps, and the failures that matter are slow: a drive that
// climbs and never comes down, a goal nothing ever picks, a population that
// quietly collapses. This measures those.
//
// Runs vary — the model is stochastic and there is no seed. Read the ranges
// and the warnings, not the exact numbers, and run it more than once.
import Farm from "../src/model/Farm.js";
import { SPECIES } from "../src/model/species.js";
import Resource from "../src/model/Resource.js";
import { DRIVES } from "../src/model/drives.js";
import { GOAL_NAMES } from "../src/model/goals.js";

const number = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = Number(process.argv[at + 1]);
  if (!Number.isFinite(value)) throw new Error(`--${name} needs a number`);
  return value;
};
const flag = (name) => process.argv.includes(`--${name}`);

const STEPS = number("steps", 800);
const HERD = number("herd", 1);
const STOCKED = flag("stocked");

const pct = (n) => `${Math.round(n * 100)}%`;

let farm = new Farm("Probe", [], [
  new Resource("water", { x: 17, y: 68 }, { name: "Pond" }),
  new Resource("water", { x: 80, y: 24 }, { name: "Trough" }),
  new Resource("grass", { x: 34, y: 30 }, { name: "Meadow" }),
  new Resource("grass", { x: 74, y: 60 }, { name: "Clover patch" }),
]);
for (const Species of SPECIES) {
  for (let i = 0; i < HERD; i++) farm = farm.add(Species.random()).farm;
}

const started = farm.size;
const openingStock = farm.stock();

const range = Object.fromEntries(DRIVES.map((d) => [d, { min: 1, max: 0 }]));
const pinned = Object.fromEntries(DRIVES.map((d) => [d, 0]));
const goalSteps = Object.fromEntries(GOAL_NAMES.map((g) => [g, 0]));
const causes = new Map();
let animalSteps = 0;
let births = 0;
let deaths = 0;
let closestTie = 0;
let contests = 0;
let knownRivals = 0;   // contests between animals that already knew each other
let worstOverlap = 0;
let emptiedAt = null;

for (let step = 1; step <= STEPS; step++) {
  for (const animal of farm.animals) {
    animalSteps += 1;
    goalSteps[animal.goal] = (goalSteps[animal.goal] ?? 0) + 1;
    for (const drive of DRIVES) {
      const level = animal.drives[drive];
      range[drive].min = Math.min(range[drive].min, level);
      range[drive].max = Math.max(range[drive].max, level);
      if (level >= 0.999) pinned[drive] += 1;
    }
    closestTie = Math.max(closestTie, 0, ...animal.bonds.values());
  }
  worstOverlap = Math.max(worstOverlap, farm.overlaps().length);

  const settled = farm.stepAll();
  const { farm: next, born, died } = settled;
  contests += settled.contests.length;
  knownRivals += settled.contests.filter((c) => c.loser.familiarity(c.winner) > 0.5).length;
  farm = next;
  births += born.length;
  deaths += died.length;
  for (const animal of died) causes.set(animal.endedBy, (causes.get(animal.endedBy) ?? 0) + 1);
  if (STOCKED) for (const source of farm.resources) source.refill(source.capacity);
  if (farm.size === 0 && emptiedAt === null) emptiedAt = step;
}

/* ------------------------------------------------------------------ */

console.log(`${STEPS} steps · ${HERD} of each species · sources ${STOCKED ? "topped up each round" : "not replenished"}\n`);

console.log("Drive ranges across every animal:");
for (const drive of DRIVES) {
  const { min, max } = range[drive];
  const share = animalSteps === 0 ? 0 : pinned[drive] / animalSteps;
  const note = share > 0.25 ? `   ← pinned at 100% for ${pct(share)} of the run` : "";
  console.log(`  ${drive.padEnd(11)} ${pct(min).padStart(4)} .. ${pct(max).padStart(4)}${note}`);
}

console.log(`\nWhat they spent their time on (${animalSteps} animal-steps):`);
for (const [goal, steps] of Object.entries(goalSteps).sort((a, b) => b[1] - a[1])) {
  const share = animalSteps === 0 ? 0 : steps / animalSteps;
  console.log(`  ${goal.padEnd(8)} ${String(steps).padStart(6)}  ${pct(share).padStart(4)}`);
}

console.log("\nPopulation:");
console.log(`  started ${started}, ${births} born, ${deaths} died, ended ${farm.size}`);
if (causes.size > 0) {
  console.log(`  causes: ${[...causes].map(([why, n]) => `${why} ×${n}`).join(", ")}`);
}
if (farm.size > 0) {
  console.log(`  now: ${farm.census().filter((c) => c.count > 0).map((c) => `${c.emoji}×${c.count}`).join(" ")}`);
  const young = farm.animals.filter((a) => !a.isAdult).length;
  const expecting = farm.animals.filter((a) => a.isPregnant).length;
  if (young || expecting) console.log(`  ${young} young, ${expecting} expecting`);
}

console.log("\nCompany:");
console.log(`  the closest tie formed all run reached ${pct(closestTie)}`);
if (farm.size > 0) {
  const mean = (xs) => (xs.reduce((s, n) => s + n, 0) / xs.length).toFixed(1);
  const known = farm.animals.map((a) => a.bonds.size);
  const close = farm.animals.map((a) => [...a.bonds.values()].filter((t) => t > 0.5).length);
  console.log(`  each ended knowing ${mean(known)} others, ${mean(close)} of them well, in a herd of ${farm.size}`);
}

console.log("\nContests over a shared trough:");
console.log(`  ${contests} in all — ${(animalSteps === 0 ? 0 : (contests / animalSteps) * 100).toFixed(1)} per 100 animal-steps`);
if (contests > 0) {
  console.log(`  ${pct(knownRivals / contests)} were between animals that already knew each other`);
}

console.log("\nIn the field:");
console.log(`  opened  ${openingStock.map((s) => `${s.label} ${s.volume}${s.unit}`).join("   ")}`);
console.log(`  closed  ${farm.stock().map((s) => `${s.label} ${s.volume}${s.unit}`).join("   ")}`);

/* ------------------------------------------------------------------ */

const warnings = [];
for (const drive of DRIVES) {
  const share = animalSteps === 0 ? 0 : pinned[drive] / animalSteps;
  if (share > 0.25) {
    warnings.push(`${drive} sat at 100% for ${pct(share)} of the run — nothing is relieving it often enough`);
  }
  if (range[drive].max < 0.3) {
    warnings.push(`${drive} never rose above ${pct(range[drive].max)} — it may not be doing anything`);
  }
}
const wanted = new Set(SPECIES.flatMap((S) => Object.entries(S.affinities).filter(([, a]) => a > 0).map(([g]) => g)));
for (const goal of GOAL_NAMES) {
  if (goalSteps[goal] === 0 && wanted.has(goal)) {
    warnings.push(`no animal ever chose "${goal}", though some species have an affinity for it`);
  }
}
if (animalSteps > 0 && closestTie < 0.5) {
  warnings.push(`no tie ever passed ${pct(closestTie)} — animals may not be standing together long enough to bond`);
}
// Ties to the dead and the departed should fade out on their own. If an
// animal is holding far more than the herd can account for, they aren't.
if (farm.size > 0) {
  const most = Math.max(...farm.animals.map((a) => a.bonds.size));
  if (most > farm.size * 2) {
    warnings.push(`one animal holds ${most} ties in a herd of ${farm.size} — the departed are not being forgotten`);
  }
}
if (worstOverlap > 0) warnings.push(`${worstOverlap} overlapping pairs seen — the no-overlap rule is broken`);
if (emptiedAt !== null) warnings.push(`the farm emptied at step ${emptiedAt}`);

console.log("");
if (warnings.length === 0) {
  console.log("Nothing looks out of balance.");
} else {
  console.log("Worth a look:");
  for (const warning of warnings) console.log(`  · ${warning}`);
}
