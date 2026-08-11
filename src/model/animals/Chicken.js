import Animal from "../Animal.js";
import { randomInt } from "../random.js";

export default class Chicken extends Animal {
  static species = "Chicken";
  static emoji = "🐔";
  static color = "#C9922F";
  static diet = ["corn", "seeds", "mealworms"];
  static breeds = ["Rhode Island Red", "Leghorn", "Plymouth Rock", "Silkie"];
  static names = ["Henrietta", "Clucky", "Nugget", "Pecky", "Goldie"];
  static stepSize = 1.5;  // short, quick scurries
  static radius = 4.5;
  static turnRate = 0.6;  // nimble — turns almost on the spot

  constructor(name, breed, age) {
    super(name, breed, age);
    this.eggsPerWeek = randomInt(4, 7);
  }

  makeSound() { return `${this.name} lets out a sharp "Bawk bawk!"`; }
  move() { return `${this.name} scurries in a tight little circle.`; }

  /**
   * Always wants to be pointed further round than it is, so its turn rate
   * caps out every step and short hops trace a tight circle (~2.5 units).
   */
  heading() { return this.facing + 1; }

  dailyProduce() {
    return { label: "Eggs", amount: Math.round((this.eggsPerWeek / 7) * 10) / 10, unit: "" };
  }

  getAttributes() {
    return [...super.getAttributes(), { label: "Eggs / week", value: this.eggsPerWeek }];
  }
}
