// Exercises the farm model with no browser and no bundler involved:
//   node scripts/demo.js
import Farm from "../src/model/Farm.js";
import Animal from "../src/model/Animal.js";
import { Cow, Duck } from "../src/model/species.js";

const at = (a) => `(${a.x.toFixed(0)}, ${a.y.toFixed(0)})`;

let farm = Farm.starter("Sunnyside");
console.log(`${farm.name}: ${farm.size} animals\n`);

for (const animal of farm.animals) {
  console.log(`${animal.emoji} ${animal.describe()}`);
  console.log(`   ${animal.makeSound()}`);
  console.log(`   ${animal.move()}`);
  console.log(`   ${animal.eat()}`);
}

console.log("\nCensus:");
for (const pen of farm.census()) {
  console.log(`  ${pen.emoji} ${pen.species.padEnd(8)} ×${pen.count}`);
}

console.log("\nDaily yield:");
for (const item of farm.dailyProduce()) {
  console.log(`  ${item.label}: ${item.amount}${item.unit ? ` ${item.unit}` : ""}`);
}

// Each species wants to go somewhere different: the pig makes for the mud,
// the duck for the pond, the sheep for the flock, the horse down the fence.
// A step is small, so it takes a good many of them to get anywhere.
const ROUNDS = 20;
console.log(`\n${ROUNDS} rounds of roaming (start → end, ${ROUNDS} steps each):`);
const start = new Map(farm.animals.map((a) => [a.id, { at: at(a), x: a.x, y: a.y }]));
for (let round = 0; round < ROUNDS; round++) farm = farm.stepAll().farm;
for (const a of farm.animals) {
  const from = start.get(a.id);
  const travelled = Math.hypot(a.x - from.x, a.y - from.y).toFixed(0);
  console.log(
    `  ${a.emoji} ${a.name.padEnd(10)} ${from.at.padEnd(10)} → ${at(a).padEnd(10)}` +
    ` ${travelled.padStart(2)} units in ${ROUNDS} steps` +
    ` (stride ${a.stepSize}, turns ≤${a.turnRate}/step)`
  );
}

// Nobody may stand on anyone else — the farm enforces it, not the animal.
console.log(`\nOverlapping pairs after roaming: ${farm.overlaps().length}`);

const crowd = farm.animals[0];
const target = farm.animals[1];
console.log(`Could ${crowd.name} stand on ${target.name}? ${farm.isClear(target, crowd)}`);

// add/remove hand back new farms; the animals themselves are shared.
const newcomer = new Cow("Marigold", "Jersey", 3);
farm = farm.add(newcomer).farm;
farm = farm.add(Duck.random()).farm;
console.log(`\nAfter two arrivals: ${farm.size} animals, placed clear at ${at(newcomer)}`);
farm = farm.remove(newcomer.id);
console.log(`After Marigold leaves: ${farm.size} animals`);

try {
  new Animal("Nobody", "None", 1);
} catch (err) {
  console.log(`\nAnimal is abstract: ${err.message}`);
}
