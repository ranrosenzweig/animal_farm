---
description: Run the full gate — check, demo, build — and report honestly what passed.
---

Run all three, in this order, and **do not stop at the first failure** — a
build error and a broken invariant are different problems and the user wants
both:

```sh
npm run check   # invariants; the real gate
npm run demo    # readable end-to-end behavior
npm run build   # the UI still compiles
```

## Reporting

- If everything passes, say so plainly in a sentence or two. Don't pad it.
- If anything fails, quote the actual output. Never summarize a failure into
  "there was an issue" — the numbers and the failing assertion are the point.
- `npm run check` is stochastic. Counts move between runs (how many animals
  fit, how many were born, how many rounds famine took) and that is not a
  regression. A **violation** is a regression; a different count is not.
- Watch `npm run demo` for output that is technically fine but reads wrong —
  an animal that never moves, a birth to the wrong species, an empty section.
  The demo exists to be read, not just to exit zero.

Do not claim a fix works because the build succeeded. The build only proves it
compiles; `npm run check` is what proves it behaves.

If you changed anything about drives, goals, resources or breeding, run
`/probe` as well — the invariant check proves nothing is broken, while the
probe is what shows whether the farm is still *balanced*. Those have already
diverged once: every invariant passed while animals were dying of thirst
beside water they never chose to drink.
