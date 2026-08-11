import Animal from "../Animal.js";
import { randomInt } from "../random.js";
import { centroid } from "../pasture.js";

export default class Sheep extends Animal {
  static species = "Sheep";
  static emoji = "🐑";
  static color = "#9B9481";
  static diet = ["grass", "oats", "alfalfa"];
  static breeds = ["Merino", "Suffolk", "Dorset", "Romney"];
  static names = ["Shirley", "Woolly", "Dolly", "Fleece", "Barbara"];
  static stepSize = 2.2;  // a shuffle
  static radius = 5;
  static turnRate = 0.3;

  constructor(name, breed, age) {
    super(name, breed, age);
    this.woolPerYear = randomInt(3, 6);
  }

  makeSound() { return `${this.name} calls out a soft "Baaaa."`; }
  move() { return `${this.name} shuffles closer to the rest of the flock.`; }

  /**
   * Flocks: aims at the middle of the other sheep, so a scattered flock
   * pulls together until personal space stops them. A lone sheep drifts.
   */
  heading({ neighbors = [] } = {}) {
    const flock = centroid(neighbors.filter((a) => a.species === this.species));
    return flock ? this.headingToward(flock) : this.amble();
  }

  getAttributes() {
    return [...super.getAttributes(), { label: "Wool / year", value: `${this.woolPerYear} kg` }];
  }
}
