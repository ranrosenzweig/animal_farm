import Animal from "../Animal.js";
import { randomInt } from "../random.js";
import { nearestFencePoint } from "../pasture.js";

export default class Cow extends Animal {
  static species = "Cow";
  static emoji = "🐄";
  static color = "#7A5230";
  static diet = ["clover", "hay", "silage"];
  static breeds = ["Holstein", "Jersey", "Angus", "Hereford"];
  static names = ["Buttercup", "Daisy", "Clover", "Bessie", "Rosie"];
  static stepSize = 1.8;   // plodding — the slowest thing in the field
  static radius = 5.5;     // takes up room
  static turnRate = 0.22;  // unhurried about changing its mind

  constructor(name, breed, age) {
    super(name, breed, age);
    this.milkPerDay = randomInt(15, 30);
  }

  makeSound() { return `${this.name} lets out a deep "Moooo!"`; }
  move() { return `${this.name} plods slowly toward the fence.`; }

  /** Makes for whichever stretch of fence is closest, then grazes along it. */
  heading() { return this.headingToward(nearestFencePoint(this)); }

  dailyProduce() { return { label: "Milk", amount: this.milkPerDay, unit: "L" }; }

  getAttributes() {
    return [...super.getAttributes(), { label: "Milk / day", value: `${this.milkPerDay} L` }];
  }
}
