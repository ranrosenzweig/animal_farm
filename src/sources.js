import { Cow, Chicken, Pig, Sheep, Horse, Duck, speciesNamed } from "./model/species.js";

// Vite hands us each module's own text, so the UI's "View source" shows the
// real class definition instead of a copy that can drift out of date. This
// lives outside src/model on purpose: the model itself stays plain JS that
// runs anywhere, and only this bundler-specific view depends on Vite.
import cowSource from "./model/animals/Cow.js?raw";
import chickenSource from "./model/animals/Chicken.js?raw";
import pigSource from "./model/animals/Pig.js?raw";
import sheepSource from "./model/animals/Sheep.js?raw";
import horseSource from "./model/animals/Horse.js?raw";
import duckSource from "./model/animals/Duck.js?raw";

const SOURCE = new Map([
  [Cow, cowSource],
  [Chicken, chickenSource],
  [Pig, pigSource],
  [Sheep, sheepSource],
  [Horse, horseSource],
  [Duck, duckSource],
]);

/** The on-disk source of a species class, by display name. */
export function sourceOf(name) {
  return SOURCE.get(speciesNamed(name)) ?? "";
}
