# Changelog

## 0.1.7

- **Fixed the card sometimes needing a hard refresh after a Home Assistant
  restart to load at all.** `manifest.json` didn't declare `lovelace` as an
  `after_dependencies` entry, so on some restarts this integration could
  finish its own setup before Lovelace had loaded its resources storage -
  when that happened, registration silently fell back to the older
  `add_extra_js_url` injection method, which is the exact mechanism known
  to get "stuck" until a manual hard refresh. Declaring the dependency
  makes the reliable real-Lovelace-resource registration path win
  consistently instead of depending on restart timing.

## 0.1.6

Found by reading the actual Home Assistant Core log (not something a user
would normally report, since neither one broke the cards):

- **Fixed a YAML syntax error in `services.yaml`** ("mapping values are not
  allowed here", line 71) - the `set_kid_photo` service's `photo` field
  description contained `data: URI` unquoted, and YAML read the `:` as a
  nested mapping key. Quoted the string. This only affected the
  description shown in Developer Tools > Services, not the service itself.
- **Fixed "State attributes ... exceed maximum size of 16384 bytes"** for
  every kid entity - `photo`, `history`, and `requests` together can
  comfortably exceed the Recorder's 16KB limit (a single photo alone can
  be tens of KB), and once they do, that state's attributes silently stop
  being stored at all. These are excluded from what the Recorder persists
  via `_unrecorded_attributes` (a real HA Entity API, not a workaround) -
  the cards keep working exactly the same since they always read the
  entity live off `hass.states`, never off Recorder-stored history.

## 0.1.5

- **Fixed the real root cause behind "I sometimes need to tap a button
  twice."** Both cards re-rendered (full DOM teardown/rebuild) on *every*
  dashboard-wide `hass` update, not just ones relevant to that card - on
  a busy Home Assistant instance that's many times a second. If a
  re-render landed between a tap's press and release, the button's DOM
  node no longer existed to receive the click. Both cards now only
  re-render when their own kid's (or kids') entity state actually
  changed, which removes nearly all of those spurious re-renders instead
  of just narrowing the timing window like the earlier rAF-batching fix
  did. Verified live: 5 simulated unrelated state changes now trigger
  zero re-renders, a real balance change still triggers exactly one.
- **The notify-device remove button no longer looks like an error
  indicator.** It reused the same solid red circle used elsewhere for
  "delete this task/reward", which read as a warning/error badge next to
  a device name rather than a remove action. It's now a plain neutral
  button (only turning red on hover), matching the up/down reorder
  buttons right above it.

## 0.1.4

- **Expanded the spelregels formatting toolbar**: three heading sizes
  (H1/H2/H3) instead of one fixed kop size, and left/center/right
  alignment buttons (new `[center]...[/center]`-style markers, since
  plain markdown has no alignment syntax of its own). Re-clicking an
  alignment button (or picking "Links") cleanly replaces any alignment
  already applied to that line instead of stacking markers.

## 0.1.3

- **Kids-card editor's notify-device picker replaced with an add/remove
  list** instead of a checkbox for every single `notify.*` service found -
  a dropdown of not-yet-added devices plus a "+ Toevoegen" button, each
  added device shown as its own removable row. Much less cluttered when
  there are several notify services to choose from.
- **The kid's name on the kids card is noticeably bigger** (1.2em -> 2em).

## 0.1.2

- **The "wat heb je gedaan" / confirm popups are no longer literally
  fullscreen** - now ~85% of the screen, centered, with rounded corners
  back. The confirm step's "Ja, versturen"/"Terug" buttons were
  completely unstyled until now (default browser buttons, stuck in the
  top-left corner) - they're now bigger, side by side, and everything
  (icon, text, buttons) is centered on the page.
- **Fixed the task icon tiles looking like bare floating emoji with huge
  empty gaps** on a wide popup - the tile grid had no max-width, so on
  the new wider popup it spread into far more columns than intended, and
  the tiles had no visible border/shadow to read as buttons in the first
  place. The grid is now capped at a sane width (centered, ~5 tiles per
  row) and every tile has a visible border and shadow.
- **The "spelregels" editor gained a small formatting toolbar** (vet,
  cursief, kop, lijst) that applies markdown to the current textarea
  selection, instead of requiring the markdown syntax to be typed by
  hand.

## 0.1.1

- **Fixed: the progress bar stopped growing once a kid's balance passed
  the configured reward goal** (still 15 by default) - it just sat
  clamped at 100% instead of extending, defeating the whole point of the
  15-credit tick marks added in 0.0.8. The configured goal is now a
  floor, not a ceiling: once balance actually grows past it, the bar
  extends to the next 15-credit mark, same as when a bigger goal is
  configured on purpose.
- **The kids-card's two kid tiles now stack on a narrow screen** (e.g. a
  portrait tablet) instead of squeezing side by side, and each tile uses
  the full available width once stacked instead of staying capped at
  340px. Reacts to the card's own rendered width (CSS container query),
  not the browser window, so it works correctly regardless of how many
  dashboard columns the card ends up in.

## 0.1.0

- **The card JS is no longer cached by the browser at all.** A
  version-bumped resource URL (0.0.6+) only helps a *fresh* page load pick
  up a new version - a tab that's already open (a kiosk tablet running
  Fully Kiosk Browser for weeks, a phone tab left open) never asks the
  server again on its own, so the version bump never reaches it either. A
  hard refresh always fixed it, which confirmed it wasn't a registration
  bug - the file itself just needed `Cache-Control: no-store`. It's a few
  dozen KB, so serving it uncached costs nothing in practice and removes
  the entire staleness class of bug, rather than narrowing the window it
  can happen in. Replaces the static-path registration with a small
  dedicated view (`KidsCreditsCardView`) that sets this on every request.

## 0.0.10

- **Fixed the notification deep link opening the app's home page instead
  of the credits dashboard.** The `clickAction` was set to a full
  `https://...` URL, which the Companion App treats as an external link
  rather than an in-app route. It's now a plain relative path
  (`/sub-dash/credits-card`), which is what the app actually matches
  against its own dashboards.

## 0.0.9

- **Fixed the task-request icon tiles becoming huge on a wide screen.**
  0.0.8's "max 5 per row" logic sized each tile as a fraction of the
  container's own width, so on a wide desktop browser that meant tiles of
  350px+ with a tiny icon lost in the middle. Tiles are now capped at a
  sane fixed size (84-140px) on any screen, and the grid simply wraps to
  more columns on wider screens instead of stretching a handful of tiles.
- **The combi kids-card editor can now reorder which kid shows first**
  (▲/▼ per kid) and has a **"Titel tonen"** toggle to hide the card's
  title entirely. The card previously always showed kids in alphabetical
  order regardless of the order they were picked in - the `kids` config
  order is now respected.
- Investigated the "card still looks narrow on a wide browser" report:
  the card itself does fill its column (confirmed live - `:host` is
  `block` and it takes the full width Home Assistant hands it). The ~500px
  cap comes from Home Assistant's own default Masonry view, which splits
  wide screens into multiple columns by design so several cards can sit
  side by side - not something a card's own CSS can or should override.
  A single full-width card needs a different view type (e.g. Panel, or
  the Sections view) rather than a card change.

## 0.0.8

- **Fixed the cards not using the available width.** Both custom elements
  were missing `:host { display: block; }`, so - depending on the
  dashboard/browser - they could size to their content instead of filling
  their column, which is what was behind the "these dimensions don't look
  right" reports on both a wide browser window and the kids' tablet. The
  progress bar, chip row, and everything else now genuinely stretches to
  the card's real width.
- **The progress bar now extends past 15 credits and gets tick marks.**
  A reward goal above 15 (e.g. 60) now shows a tick + number (1, 2, 3...)
  at every 15-credit mark along the bar instead of just being one longer
  featureless bar, so bigger goals stay readable at a glance.
- **New `kids-credits-rules-card`**: a small collapsible ("spelregels")
  card for the family's house rules, using a native `<details>` element
  (no extra JS needed for the collapse) with an editable `rules` markdown
  field (headings, bullet lists, bold/italic) in the visual editor.
- **Every push notification now deep-links to the credits dashboard**
  (`https://home.jonishome.nl/sub-dash/credits-card`) instead of just
  opening the app to its default page.
- Example dashboard now shows one kids-card instance covering both kids
  (not one per kid) - the way to keep everything in a single card on a
  shared tablet.

## 0.0.7

- **Fixed a real bug: the manual +/- toekenning on the parent card sometimes
  silently did nothing**, even with a valid amount and reason typed in. A
  background re-render (any hass state tick) replaces the whole card,
  including the manual amount/reason inputs - if that happened in the gap
  between finishing typing and tapping +/- (no input focused at that exact
  moment, e.g. right after the on-screen keyboard closes), the fields were
  silently wiped back to empty before the tap landed, so the resulting
  click read empty values and did nothing. The typed amount/reason now
  survive any number of re-renders, not just while an input has focus.
- **The kids card's "wat heb je gedaan" request popup is now grouped per
  credit amount** (one heading + row per tier, matching the parent card's
  own task groups) instead of one flat grid, and each tile's caption now
  sits below its icon instead of squeezed next to it. Rows are capped at 5
  tiles wide so nothing gets uncomfortably small on a bigger screen.

## 0.0.6

- **The card now registers itself as a real Lovelace resource** (the same
  mechanism the "Add Resource" dialog and HACS's own "Plugin"-category repos
  use) instead of only the lighter-weight `add_extra_js_url` injection.
  Several HACS integrations that use `add_extra_js_url` (this one included)
  have had reports of the card/its icons needing a manual browser
  hard-refresh or a Companion App "reset frontend cache" after an update - a
  real resource entry doesn't have that problem, since it goes through the
  exact code path a manually-added resource does. Falls back to the old
  injection automatically if a real resource can't be registered (YAML-mode
  dashboards, or Lovelace not finished loading yet) - never a hard failure.

## 0.0.5

- **Icon tiles now show a short caption** (e.g. "Knutselen") instead of no
  text at all, and tapping one opens a confirm step showing the full task
  description before the request is actually sent - icon-only turned out to
  not be enough information on its own. Each task now has three parts:
  `icon`, `short` (tile caption), `label` (full description, still what's
  sent to the parent for approval).
- **Kid photos on the kids card are ~4x bigger** (48px -> 192px), and the
  upload pipeline now targets a slightly higher-resolution crop (320px) to
  match.
- **Fixed a real bug**: taps sometimes did nothing right after awarding
  credits, or other unrelated activity. A full card re-render replaces every
  button's DOM node; if that happened between a tap's press and release
  (likely right after an award, since the award itself triggers a
  re-render), the tap silently had nothing to land on. Re-renders triggered
  by hass ticks are now coalesced to at most one per animation frame instead
  of one per tick, shrinking that window a lot.

## 0.0.4

- **The kids card's "wat heb je gedaan" popup is now a full-screen grid of
  big icon-only tiles**, not a wall of text buttons - a kid picks the
  picture of the task they did instead of having to read anything. Each
  task now has an editable emoji `icon` alongside its `label` (the parent
  card's own task popup still shows both icon and text, since parents need
  to read it to confirm); the editor's task rows gained a small icon input
  next to the label. Falls back to a free-text field for anything not
  pictured. The default icons are plain emoji picked as placeholders -
  swap any of them for a better one per task in the editor at any time, no
  rush.

## 0.0.3

- **Entities moved from `sensor.<naam>` to their own `kids_credits.<naam>`
  domain** - easier to pick out from the rest of your entities, and matches
  the `kids_credits.*` service names. This is a breaking rename: re-add the
  cards after updating so they pick up the new entity ids (they auto-discover
  entities, no config change needed beyond that).
- **Fixed: the manual +/- buttons on the parent card silently did nothing.**
  The input you'd just typed into kept focus after clicking +/-, and the
  same guard that protects in-progress typing from being wiped by an
  unrelated dashboard update was also blocking the re-render that should
  have shown the result of your own click.
- **Photo upload and "geschiedenis wissen" (clear history) moved into the
  card editor only** - neither is reachable from the live dashboard card
  anymore, so a kid tapping around can't accidentally trigger or change
  either one.
- **Photos are now auto-cropped and resized before upload.** A raw phone
  photo (often several MB) is center-cropped to a square and downscaled to
  a small JPEG entirely in the browser before it's ever sent to
  `set_kid_photo`, so it reliably fits well under the backend's size cap
  regardless of the original photo's resolution.
- **Kids can now request a reward themselves, not just task credit.** When a
  kid has enough saved up, a "🎁 Beloning aanvragen" button appears on their
  kids-card tile; approving it on the parent card *deducts* credits instead
  of awarding them (new `kids_credits.request_reward` service, and
  `approve_request`/`reject_request` now handle both request kinds).
- **The "Ik heb een klus gedaan" popup now shows task buttons**, not a text
  box - a kid who can't read/write well yet can tap the task they did
  instead of typing it. Falls back to a free-text field for anything not in
  the list. The kids card gained its own editable `groups` config (same
  editor UI as the parent card, shared code) so these buttons can be
  customized independently of what a parent card shows.
- **`kids_credits.clear_history`**: wipes a kid's ledger (and therefore
  resets their balance to 0, since balance is just the sum of the ledger) -
  editor-only, behind a tap-twice-to-confirm button.
- Approving a request now pre-fills the amount field with the kid's own
  suggested amount (from tapping a task/reward button) instead of leaving it
  blank - the parent can still change it before approving.
- **Kids card gains a `notify_services: [...]` config** (checklist in its
  editor, populated from your existing `notify.*` services): every phone
  checked there gets a push notification the moment a kid submits a credit
  or reward request, so a parent doesn't have to have the dashboard open to
  notice one is waiting.

## 0.0.2

- **Parent card is now per-kid + per-parent**: config gains required `kid_id`
  and `actor` fields instead of one shared card with a free-text actor input
  and every kid stacked on it. Place one card instance per (kid, parent)
  combination - 2 kids x 2 parents = 4 cards, each on only that parent's own
  dashboard.
- **Task/deduction/reward lists moved into popups** opened from a chip row
  (one chip per credit tier, one for deductions, one for rewards), instead of
  always-visible inline button lists.
- **Visual (GUI) editors** for both cards - no more hand-written YAML
  required. The parent card's editor has collapsible sections per credit
  group (add/remove groups and individual tasks), a deductions list editor,
  and a rewards list editor (label + cost per reward).
- **Rewards menu with optional push notification**: `rewards: [{label, cost}]`
  replaces the single fixed-threshold "Beloning uitkeren" button; an optional
  `notify_service` config fires a push notification through that HA notify
  service when a reward is redeemed.
- **Kid photo upload**: click the small camera badge on a kid's avatar
  (parent card only) to upload a photo, stored centrally via the new
  `kids_credits.set_kid_photo` service so every card showing that kid picks
  it up.
- **History popup**: clicking a kid's name or avatar (on either card) opens
  a popup listing every ledger entry with the task, amount, date/time and
  who awarded it. The kids card's version is read-only, same as the rest of
  that card.
- **Kids card gains a `kids: [id, ...]` config field** to pick which kid(s)
  appear on it (empty/omitted = all), so a single-kid kids-card is possible
  too.
- **Kids can now request credit for a task themselves**: a "✋ Ik heb een
  klus gedaan!" button on the kids card opens a popup to describe what they
  did, creating a *pending* request - nothing about their balance changes
  yet. Every parent card shows a "📥 Verzoeken" chip with the pending count;
  opening it lets that parent enter an amount and approve (awards the
  credits) or reject (no balance change) each request. The kids card also
  gets a per-kid requests overview popup showing every request's status
  (pending/approved/rejected). New services: `kids_credits.request_credit`,
  `kids_credits.approve_request`, `kids_credits.reject_request`.

## 0.0.1

- First version: kids + credit ledger backend (`kids_credits.award_points` /
  `deduct_points` / `redeem_reward` services, one balance sensor per kid),
  a parent Lovelace card with buttons matching the family's task list, and a
  read-only kids Lovelace card for a shared tablet.
