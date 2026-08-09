# Changelog

## Unreleased

- **The kids card's "wat heb je gedaan" popup is now a full-screen grid of
  big icon-only tiles**, not a wall of text buttons - a kid picks the
  picture of the task they did instead of having to read anything. Each
  task now has an editable emoji `icon` alongside its `label` (the parent
  card's own task popup still shows both icon and text, since parents need
  to read it to confirm); the editor's task rows gained a small icon input
  next to the label. Falls back to a free-text field for anything not
  pictured.

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
