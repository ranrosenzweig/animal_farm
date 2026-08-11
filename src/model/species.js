import Cow from "./animals/Cow.js";
import Chicken from "./animals/Chicken.js";
import Pig from "./animals/Pig.js";
import Sheep from "./animals/Sheep.js";
import Horse from "./animals/Horse.js";
import Duck from "./animals/Duck.js";

/**
 * Every species the farm knows how to keep. Adding a kind of animal means
 * writing one class and adding it here — nothing else in the model needs
 * to know the list.
 */
export const SPECIES = [Cow, Chicken, Pig, Sheep, Horse, Duck];

/** Look a species class up by its display name, e.g. "Cow". */
export function speciesNamed(name) {
  return SPECIES.find((Species) => Species.species === name);
}

export { Cow, Chicken, Pig, Sheep, Horse, Duck };
