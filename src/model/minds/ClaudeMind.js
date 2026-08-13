import Mind from "./Mind.js";

/**
 * Asks Claude what the animal should want.
 *
 * The awkward part is that `decide()` is called from inside the step loop, and
 * that loop is synchronous the whole way down — `Farm.stepOne` does not await
 * anything, and cannot without every caller awaiting too. So this mind never
 * waits. Each deliberation hands back the answer to the *previous* one and
 * sends the current percept off for the next.
 *
 * That leaves the animal one deliberation behind, which sounds worse than it
 * is: at the default cadence a deliberation is twelve steps — some seconds of
 * wall clock — and the round trip is shorter than that, so the answer is
 * already waiting by the time it is asked for.
 *
 * Until the first answer arrives, and after any that fails, the animal keeps
 * the goal it already had. A mind that cannot be reached is an animal that
 * carries on doing what it was doing.
 */
export default class ClaudeMind extends Mind {
  /** Deliberate every N steps. Every one of them is a paid request. */
  static cadence = 12;

  /**
   * @param {{ endpoint?: string, cadence?: number }} [options]
   *   endpoint — where the proxy is. Relative works in the browser, where Vite
   *   forwards /decide; a script under Node needs the whole URL.
   */
  constructor({ endpoint = "/decide", cadence } = {}) {
    super();
    this.endpoint = endpoint;
    this.overrideCadence = cadence;
    /** @type {import("./Mind.js").Intention | null} the last answer received */
    this.latched = null;
    /** A request is already out; asking again on top of it just costs money. */
    this.asking = false;
    /** Why the last request failed, or null while it is working. */
    this.error = null;
  }

  get cadence() { return this.overrideCadence ?? ClaudeMind.cadence; }

  /**
   * @param {import("./Mind.js").Percept} percept
   * @returns {import("./Mind.js").Intention}
   */
  decide(percept) {
    if (!this.asking) this.ask(percept);
    return this.latched ?? { goal: percept.self.goal, reason: "thinking it over" };
  }

  /** Fire and forget. The answer lands in `latched` for the next deliberation. */
  async ask(percept) {
    this.asking = true;
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(percept),
      });
      if (!response.ok) throw new Error(`${this.endpoint} answered ${response.status}`);
      this.latched = await response.json();
      this.error = null;
    } catch (cause) {
      this.error = cause.message;
    } finally {
      this.asking = false;
    }
  }
}
