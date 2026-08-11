// Exercises the farm model with no browser and no bundler involved:
//   node scripts/demo.js
import Farm from "../src/model/Farm.js";
import Animal from "../src/model/Animal.js";
import { Cow, Duck } from "../src/model/species.js";

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

// add/remove hand back new farms; the animals themselves are shared.
const newcomer = new Cow("Marigold", "Jersey", 3);
farm = farm.add(newcomer).add(Duck.random());
console.log(`\nAfter two arrivals: ${farm.size} animals`);
farm = farm.remove(newcomer.id);
console.log(`After Marigold leaves: ${farm.size} animals`);

try {
  new Animal("Nobody", "None", 1);
} catch (err) {
  console.log(`\nAnimal is abstract: ${err.message}`);
}
