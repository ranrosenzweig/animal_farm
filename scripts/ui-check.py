"""Audit the pasture UI in a real browser.

`npm run check` proves the model's rules — overlaps, the fence, stride length.
None of that says the page draws what the model holds, so this walks the UI:
boots it, selects an animal, adds one, puts down water by mouse and grass by
keyboard, and lets them roam.

Expects the dev server already running; `npm run ui-check` starts one first.
"""

import argparse
import re
import sys
from playwright.sync_api import sync_playwright

# Animal names and the arrows below outrun the Windows console's default cp1252.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SPECIES = ["Cow", "Chicken", "Pig", "Sheep", "Horse", "Duck"]
STEP_MS = 600

findings = []
failures = []


def note(line):
    findings.append(line)


def fail(line):
    failures.append(line)


def sprites(page):
    """Every animal on the field, as the page has it: name and rendered spot."""
    return page.eval_on_selector_all(
        ".fa-sprite",
        """els => els.map(el => ({
             name: el.querySelector('.tag').textContent.trim(),
             x: parseFloat(el.style.left),
             y: parseFloat(el.style.top),
           }))""",
    )


def census(page):
    """Head count per species, read off the header chips."""
    text = page.eval_on_selector_all(
        ".fa-chip", "els => els.map(el => el.textContent.trim())"
    )
    counts = {}
    for chip in text:
        match = re.search(r"(\w+)\s*×(\d+)", chip)
        if match:
            counts[match.group(1)] = int(match.group(2))
    return counts


def check_boot(page, errors):
    """The page comes up with every pen represented and nothing thrown."""
    pens = census(page)
    missing = [s for s in SPECIES if s not in pens]
    if missing:
        fail(f"header is missing a pen for {', '.join(missing)}")

    on_field = sprites(page)
    if sum(pens.values()) != len(on_field):
        fail(f"header counts {sum(pens.values())} but {len(on_field)} are drawn")

    if errors:
        fail(f"{len(errors)} console error(s) on load: {errors[0]}")

    note(f"Booted with {len(on_field)} animals across {len(pens)} pens.")


def check_selection(page):
    """Clicking an animal opens its card, and the card is really its class."""
    first = page.locator(".fa-sprite").first
    tag = first.locator(".tag").inner_text().strip()
    name = tag.rsplit(" ", 1)[0]
    first.click()

    card = page.locator(".fa-card-name").inner_text()
    if name not in card:
        fail(f"clicked {name} but the card reads {card.strip()!r}")

    species = page.locator(".fa-card-species").inner_text().strip()
    page.get_by_role("button", name="View source").click()
    source = page.locator(".fa-card .fa-code").inner_text()
    if species.replace("class ", "").split(" extends")[0] not in source:
        fail(f"source panel does not show {species!r}")
    page.get_by_role("button", name="Hide source").click()

    note(f"Selected {name}; the card and its source agree ({species}).")


def check_add(page):
    """Adding a duck adds exactly one duck, and says so."""
    before = census(page).get("Duck", 0)
    page.locator(".fa-add select").select_option("Duck")
    page.get_by_role("button", name="+ Add to pasture").click()

    after = census(page).get("Duck", 0)
    if after != before + 1:
        fail(f"added a duck but the pen went {before} → {after}")

    log = page.locator(".fa-log-row").first.inner_text()
    if "duck" not in log.lower():
        fail(f"nothing in the log about the new duck; top entry was {log.strip()!r}")

    note(f"Added a duck: pen {before} → {after}, logged.")


def check_place_water(page):
    """Water lands where the farmer clicked, and the field shows more of it."""
    before = len(page.locator(".fa-water").all())
    stock_before = page.locator(".fa-yield").first.inner_text()

    page.get_by_role("button", name="💧 water").click()
    box = page.locator(".fa-pasture").bounding_box()
    page.locator(".fa-pasture").click(
        position={"x": box["width"] * 0.25, "y": box["height"] * 0.40}
    )

    blobs = page.eval_on_selector_all(
        ".fa-water",
        "els => els.map(el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }))",
    )
    if len(blobs) != before + 1:
        fail(f"clicked to place water but the field has {len(blobs)}, not {before + 1}")
    else:
        placed = blobs[-1]
        off = max(abs(placed["x"] - 25), abs(placed["y"] - 40))
        if off > 2:
            fail(f"water landed at {placed['x']:.0f},{placed['y']:.0f}% — clicked 25,40%")
        else:
            note(f"Water landed at {placed['x']:.0f},{placed['y']:.0f}% for a click at 25,40%.")

    if page.locator(".fa-yield").first.inner_text() == stock_before:
        fail("stock line did not change after putting water down")

    # The keyboard's aim marker is furniture the mouse never asked for: armed by
    # click, the field should look exactly as it always did.
    page.get_by_role("button", name="💧 water").click()
    aim = page.locator(".fa-aim")
    if aim.count() and aim.evaluate("el => getComputedStyle(el).opacity") != "0":
        fail("the keyboard aim marker is showing for a mouse-armed placement")
    page.get_by_role("button", name="💧 water").click()


def check_place_by_keyboard(page):
    """Water and grass go down without a pointer — WCAG 2.1.1, and it must stay.

    Arms grass from the keyboard, then asks for the three things that make the
    capability real: the field takes focus, something visible says where the
    drop point is, and the arrows move it there before Enter lands it.
    """
    before = len(page.locator(".fa-grass").all())
    page.get_by_role("button", name="🌿 grass").focus()
    page.keyboard.press("Enter")

    if not page.eval_on_selector(".fa-pasture", "el => el === document.activeElement"):
        fail("arming grass from the keyboard left focus outside the pasture — "
             "nothing there can hear an arrow key")
        return

    aim = page.locator(".fa-aim")
    if aim.count() == 0 or aim.evaluate("el => getComputedStyle(el).opacity") == "0":
        fail("nothing on the field marks where the keys would drop the grass")
        return

    spot = "el => [parseFloat(el.style.left), parseFloat(el.style.top)]"
    start = aim.evaluate(spot)
    for key in ("ArrowRight", "ArrowRight", "ArrowUp"):
        page.keyboard.press(key)
    aimed = aim.evaluate(spot)
    # Two right and one up, unless the fence stopped it short of a full nudge.
    if not (start[0] < aimed[0] <= start[0] + 10 and start[1] - 5 <= aimed[1] < start[1]):
        fail(f"arrow keys moved the drop point {start} → {aimed}, not right and up")

    page.keyboard.press("Enter")
    blobs = page.eval_on_selector_all(
        ".fa-grass",
        "els => els.map(el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }))",
    )
    if len(blobs) != before + 1:
        fail(f"Enter should have put grass down; the field has {len(blobs)}, not {before + 1}")
        return

    placed = blobs[-1]
    off = max(abs(placed["x"] - aimed[0]), abs(placed["y"] - aimed[1]))
    if off > 0.5:
        fail(f"grass landed at {placed['x']:.0f},{placed['y']:.0f}% — "
             f"aimed at {aimed[0]:.0f},{aimed[1]:.0f}%")

    # The pasture stops being a tab stop the moment it lands, so focus has to go
    # somewhere deliberate or the keyboard farmer is back at the top of the page.
    landed_on = page.evaluate("() => document.activeElement.textContent.trim()")
    if "grass" not in landed_on:
        fail(f"after dropping, focus went to {landed_on!r} instead of back to the grass button")

    note(f"Keyboard put grass down at {placed['x']:.0f},{placed['y']:.0f}% "
         f"(aimed from the herd at {start[0]:.0f},{start[1]:.0f}%).")


def check_resource_colour(page):
    """A pond should not be drawn in the colour of the source-code panel.

    Both the resource blobs and the code viewer are class `fa-source`, so
    whichever rule comes last in the stylesheet wins for both.
    """
    water = page.locator(".fa-water").first
    shade = water.evaluate("el => getComputedStyle(el).backgroundColor")
    image = water.evaluate("el => getComputedStyle(el).backgroundImage")
    if "gradient" not in image:
        fail(f"water is drawn as flat {shade} — its gradient was overridden")
    else:
        note(f"Water keeps its own gradient ({shade} behind it).")


def check_roaming(page):
    """Let them roam: animals move, and nobody leaves the field."""
    start = {s["name"]: (s["x"], s["y"]) for s in sprites(page)}
    page.get_by_role("button", name="Let them roam").click()
    page.wait_for_timeout(STEP_MS * 6)

    end = sprites(page)
    page.get_by_role("button", name="Stop roaming").click()

    moved = sum(
        1 for s in end
        if s["name"] in start and (s["x"], s["y"]) != start[s["name"]]
    )
    if moved == 0:
        fail("six steps of roaming and not one animal moved")

    strayed = [s for s in end if not (0 <= s["x"] <= 100 and 0 <= s["y"] <= 100)]
    if strayed:
        fail(f"{strayed[0]['name']} was drawn outside the pasture at "
             f"{strayed[0]['x']:.0f},{strayed[0]['y']:.0f}%")

    note(f"Roamed six steps: {moved} of {len(end)} animals found room.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:5173")
    parser.add_argument("--screenshot", help="write a full-page png here")
    args = parser.parse_args()

    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(args.url)
        page.wait_for_load_state("networkidle")
        page.wait_for_selector(".fa-sprite")

        check_boot(page, errors)
        check_selection(page)
        check_add(page)
        check_place_water(page)
        check_place_by_keyboard(page)
        check_resource_colour(page)
        check_roaming(page)

        if args.screenshot:
            page.screenshot(path=args.screenshot, full_page=True)
        browser.close()

    for line in findings:
        print(line)
    if failures:
        print()
        for line in failures:
            print(f"FAIL — {line}")
        return 1
    print("OK — the page drew what the model held, the whole way through.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
