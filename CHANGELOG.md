# Changelog

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
