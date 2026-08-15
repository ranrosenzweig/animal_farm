// Vite hands us each module's own text, so the UI's "View source" shows the
// real class definition instead of a copy that can drift out of date. This
// lives outside src/model on purpose: the model itself stays plain JS that
// runs anywhere, and only this bundler-specific view depends on Vite.
const SOURCE = import.meta.glob("./model/animals/*.js", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * The on-disk source of a species class, by display name.
 * ponytail: assumes the file is named for the species, true of all six. A
 * species whose file disagrees returns "" — go back to a class-keyed Map.
 */
export function sourceOf(name) {
  return SOURCE[`./model/animals/${name}.js`] ?? "";
}
