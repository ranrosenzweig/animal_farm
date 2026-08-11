/**
 * The ground the animals stand on.
 *
 * Positions are percentages of the pasture box, so the model stays
 * independent of how large the field is rendered. Distances are measured in
 * those same percentage units — on a non-square field a "circle" of a given
 * radius is really an ellipse on screen, which is close enough for keeping
 * sprites out of each other's laps.
 */
export const PASTURE = { minX: 6, maxX: 90, minY: 16, maxY: 78 };

/** Fixed features animals steer toward. */
export const POND = { x: 17, y: 68 };
export const MUD = { x: 68, y: 62 };

export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const inBounds = ({ x, y }) =>
  x >= PASTURE.minX && x <= PASTURE.maxX && y >= PASTURE.minY && y <= PASTURE.maxY;

export const clampToPasture = ({ x, y }) => ({
  x: Math.min(PASTURE.maxX, Math.max(PASTURE.minX, x)),
  y: Math.min(PASTURE.maxY, Math.max(PASTURE.minY, y)),
});

/** The closest point on the fence to `point` — whichever edge is nearest. */
export function nearestFencePoint(point) {
  const candidates = [
    { x: PASTURE.minX, y: point.y },
    { x: PASTURE.maxX, y: point.y },
    { x: point.x, y: PASTURE.minY },
    { x: point.x, y: PASTURE.maxY },
  ];
  return candidates.reduce((best, c) => (distance(point, c) < distance(point, best) ? c : best));
}

/** Average position of a group, or null if the group is empty. */
export function centroid(points) {
  if (points.length === 0) return null;
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}
