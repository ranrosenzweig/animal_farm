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
  static mass = 2.5;      // the lightest thing in the field
  static radius = 4.5;
  static turnRate = 0.6;  // nimble — turns almost on the spot

  // Pecks constantly and keeps its own company.
  static affinities = { graze: 1.0, roam: 0.7, drink: 0.5, rest: 0.4, flock: 0.2, wallow: 0, mate: 0.5 };
  static driveRates = { hunger: 0.009, thirst: 0.005, fatigue: 0.002, loneliness: 0.002, urge: 0.004 };
  static intake = 0.3;

  constructor(name, breed, age) {
    super(name, breed, age);
    this.eggsPerWeek = randomInt(4, 7);
  }

  makeSound() { return `${this.name} lets out a sharp "Bawk bawk!"`; }
  move() { return `${this.name} scurries in a tight little circle.`; }

  /**
   * Left to itself it always wants to be pointed further round than it is,
   * so its turn rate caps out every step and short hops trace a tight
   * circle (~2.5 units).
   */
  roamHeading() { return this.facing + 1; }

  dailyProduce() {
    return { label: "Eggs", amount: Math.round((this.eggsPerWeek / 7) * 10) / 10, unit: "" };
  }

  getAttributes() {
    return [...super.getAttributes(), { label: "Eggs / week", value: this.eggsPerWeek }];
  }
}
