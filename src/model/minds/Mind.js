/**
 * The seam between an animal's body and whatever decides what it wants.
 *
 * A Mind is handed a **percept** — plain, serializable data describing what
 * the animal can currently sense and what it could do about it — and returns
 * an **intention**: one goal name, and a sentence about why.
 *
 * That is the whole contract. It holds no reference to the animal, the farm,
 * or any live object, which is the point: the same percept that a scripted
 * mind scores arithmetically could be dropped into a prompt and answered by
 * a language model, without either one knowing about the other.
 *
 * @typedef {{
 *   time: { hour: string, phase: string, daylight: boolean, season: string, awake: boolean },
 *   self: { name: string, species: string, goal: string, drives: Record<string, number> },
 *   options: { goal: string, affinity: number, pressure: number }[],
 *   nearby: { name: string, species: string, distance: number, familiarity: number }[],
 * }} Percept
 *
 * @typedef {{ goal: string, reason: string }} Intention
 */
export default class Mind {
  /**
   * How many steps pass between deliberations. A body ticks every step; a
   * mind need not. Raise this for a mind that is slow or expensive to ask.
   * @type {number}
   */
  static cadence = 1;

  /** @param {{ cadence?: number }} [options] overrides this kind's default. */
  constructor({ cadence } = {}) {
    this.overrideCadence = cadence;
  }

  get cadence() { return this.overrideCadence ?? this.constructor.cadence; }

  /**
   * @param {Percept} _percept
   * @returns {Intention}
   */
  decide(_percept) {
    throw new Error(`${this.constructor.name} must implement decide(percept).`);
  }
}
