/**
 * What an animal feels. Drives run 0 (satisfied) to 1 (desperate), rise on
 * their own, and fall only while the animal is doing something about them.
 *
 * A drive is pressure, not a decision — it is the raw material a Mind reads
 * when it picks a goal. Nothing here knows what an animal will do about being
 * hungry; that is the Mind's business.
 */
export const DRIVES = ["hunger", "thirst", "fatigue", "loneliness"];

export const DRIVE_LABELS = {
  hunger: "Hunger",
  thirst: "Thirst",
  fatigue: "Fatigue",
  loneliness: "Loneliness",
};

export const clamp01 = (n) => Math.min(1, Math.max(0, n));

/** A fresh set of drives, each starting somewhere unremarkable. */
export const startingDrives = (random = Math.random) =>
  Object.fromEntries(DRIVES.map((d) => [d, clamp01(random() * 0.4)]));
