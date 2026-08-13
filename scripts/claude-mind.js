// Runs a real farm with every animal thinking through Claude, and shows what
// it decided. Needs the proxy up in another terminal:
//
//   npm run proxy
//   npm run mind
//
// Every deliberation here is a paid request, so this is deliberately short:
// six animals, a deliberation every few steps, a couple of dozen steps.
import Farm from "../src/model/Farm.js";
import ClaudeMind from "../src/model/minds/ClaudeMind.js";

// 127.0.0.1, not localhost: the proxy listens on loopback v4 only, and
// localhost can resolve to ::1 first.
const ENDPOINT = `http://127.0.0.1:${process.env.PORT ?? 8787}/decide`;
const STEPS = 24;
const CADENCE = 8;
// The step loop cannot await a request, so the script has to leave the event
// loop long enough for one to land. In the browser this is just the tick rate.
const STEP_MS = 250;

let farm = Farm.starter("Sunnyside");
for (const animal of farm.animals) {
  animal.mind = new ClaudeMind({ endpoint: ENDPOINT, cadence: CADENCE });
}

console.log(`${farm.name}: ${farm.size} animals, all thinking via ${ENDPOINT}`);
console.log(`${STEPS} steps, deliberating every ${CADENCE}\n`);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (let step = 1; step <= STEPS; step += 1) {
  const before = new Map(farm.animals.map((a) => [a.id, a.goal]));
  farm = farm.stepAll().farm;
  for (const animal of farm.animals) {
    if (before.get(animal.id) === animal.goal) continue;
    console.log(
      `  step ${String(step).padStart(2)}  ${animal.emoji} ${animal.name.padEnd(10)}` +
      ` ${animal.goal.padEnd(7)} — ${animal.intention.reason}`
    );
  }
  await wait(STEP_MS);
}

console.log("\nWhere they ended up:");
for (const animal of farm.animals) {
  const felt = Object.entries(animal.drives)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 2)
    .map(([drive, level]) => `${drive} ${Math.round(level * 100)}%`)
    .join(", ");
  console.log(
    `  ${animal.emoji} ${animal.name.padEnd(10)} ${animal.goal.padEnd(7)}` +
    ` — ${animal.intention.reason.padEnd(34)} (${felt})`
  );
}

// A mind that never got an answer looks exactly like a mind that agreed with
// itself, so say so rather than letting a broken proxy pass for a quiet farm.
const failed = farm.animals.filter((a) => a.mind.error);
const thinking = farm.animals.filter((a) => !a.mind.error && a.mind.latched == null);
if (failed.length > 0) {
  console.log(`\n${failed.length} of ${farm.size} never got an answer: ${failed[0].mind.error}`);
} else if (thinking.length > 0) {
  console.log(`\n${thinking.length} of ${farm.size} are still waiting on a first answer.`);
} else {
  console.log(`\nAll ${farm.size} decided through Claude.`);
}
