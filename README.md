# Kids Credits

A simple family chore/reward credit system for Home Assistant. Parents award
or deduct credits per kid (per task, or freeform with a reason); kids see
their own balance on a read-only dashboard. Ships its own Lovelace cards
with full visual (GUI) editors — no YAML required, though YAML mode still
works if you prefer it.

## Why two cards, not one

- `kids-credits-parent-card` — **one card per kid, per parent.** Its config
  is tied to a single `kid_id` and a single `actor` (which parent this card
  belongs to) — no shared free-text "who am I" field to get wrong. With 2
  kids and 2 parents you place 4 card instances, one per (kid, parent) pair.
  Put each parent's cards only on a dashboard/view that parent actually
  opens.
- `kids-credits-kids-card` — read-only balance + progress bar; the only
  thing it can do beyond displaying is let a kid *submit a request* (for
  credit or a reward), which never changes a balance by itself and always
  needs a parent's approval on their own card. Its `kids` config picks which
  kid(s) show on it (leave empty for "all"), so you can show both kids
  together or give each their own card. Meant for a shared kids tablet.

There is no login/permission system inside the integration itself — "only
parents can change credits" is enforced simply by which dashboard/device a
parent card is shown on. See
[dashboards/kids_credits.yaml](dashboards/kids_credits.yaml) for an example
with a "Papa" view, a "Mama" view (each with one card per kid), and a shared
"Kinderen" view.

## Installation

### HACS (custom repository)

1. Go to integrations
2. Press the dotted menu in the top right corner
3. Choose custom repositories
4. Add the URL to this repository, category `Integration`
5. Install, restart Home Assistant

### Manual

Copy `custom_components/kids_credits` into your Home Assistant `custom_components/` folder and restart.

### Card not showing up / stuck on an old version after an update?

The card JS registers itself as a real Lovelace resource on startup (the
same mechanism the "Add Resource" dialog uses), specifically to avoid the
stale-card-after-update problem some HACS integrations have. If you're on a
YAML-mode dashboard, or you updated but still see the old card, add the
resource manually once: Settings → Dashboards → ⋮ → Resources → Add
Resource → `/kids_credits_static/kids-credits-cards.js`, type JavaScript
Module.

## Setup

Settings → Devices & Services → Add integration → **Kids Credits**. You'll be asked for:

- **Kids** — comma-separated names, e.g. `Limanah, Aline`
- **Credits for a reward** — default `15`, used as the fallback reward when a
  card doesn't define its own `rewards` list (see below)

Both are editable later via the integration's **Configure** button. Renaming
a kid in that field creates a *new* kid with fresh history — it does not
rename the existing one in place.

Each kid gets one `kids_credits.<name>` entity (its own domain, not
`sensor.*`, so it's easy to pick out from the rest of your entities): its
state is the current balance,
with attributes `photo`, `reward_threshold`, `credits_until_reward`,
`reward_available`, `lifetime_earned`, `lifetime_deducted`, and a `history`
list of the most recent ledger entries (reason, delta, timestamp, actor).

## Adding a card

Add Card → search "Kids Credits" → pick a card → the visual editor opens
automatically. For the parent card, pick a **kid** and type in the **actor**
(e.g. "papa"); repeat once per (kid, parent) combination you want. For the
kids card, tick which kid(s) should appear.

### Parent card: tasks, deductions, rewards

Tap a chip on the card (e.g. "+3 · 3 credits") to open a popup with the
individual tasks in that group — tapping a task there awards the credits and
closes the popup. The same pattern applies to the "Credits in mindering"
(deduction) chip and the "🎁 Beloning uitkeren" chip.

All three lists are edited in the card's own visual editor, under
collapsible sections:

- **Taken per aantal credits** — add/remove whole groups (a group is a
  credit amount + a label + a list of tasks), and add/remove individual
  tasks within a group.
- **Credits in mindering** — a flat list of reasons; each gets a +/- stepper
  in the popup so the deducted amount is adjustable per click (the source
  document didn't specify fixed amounts for these, so 1 is just the
  default).
- **Beloningen** — a list of `{ naam, credits }` rewards. Leave this empty
  to fall back to a single reward at the integration's configured
  `reward_threshold`.

Editing these lists only changes the one card instance you're editing — with
4 cards (2 kids x 2 parents) sharing the same task list, the easiest way to
keep them in sync is to edit one card in the visual editor, switch that
card to YAML mode, copy the `groups`/`deductions`/`rewards` keys, and paste
them into the other three.

### Push notification on reward redemption

The parent card's editor has a **"Pushbericht bij beloning"** dropdown,
populated from your existing `notify.*` services. When set, redeeming any
reward on that card also sends a notification (title "Kids Credits", message
naming the kid and the reward) through that service.

### Kid photo and clearing history — editor only

Both live only in the parent card's visual editor, never on the live
dashboard card itself, so a kid tapping around the actual card can't
accidentally trigger or change either one:

- **Foto van dit kind** — upload a photo from that device. It's automatically
  center-cropped to a square and downscaled to a small JPEG in the browser
  before upload (so even a multi-MB phone photo ends up as a few KB), then
  stored centrally (via `kids_credits.set_kid_photo`) so every card showing
  that kid — including the read-only kids card — picks it up immediately.
  Leaving a kid without a photo just shows their configured mdi icon instead.
  A "Foto verwijderen" button appears once a photo is set.
- **Geschiedenis wissen** — wipes that kid's ledger. Since the balance is
  just the sum of the ledger, this also resets it to 0; there's no way to
  clear the log while keeping the balance. Tap-twice-to-confirm (the button
  arms itself for 4 seconds after the first tap), no native browser popup.

### History popup

Tap a kid's name or avatar (on either card) to open a popup listing every
ledger entry for that kid: the task/reason, the amount, when it happened,
and who awarded it. On the kids card this is read-only, same as the rest of
that card.

### Kids requesting credit or a reward themselves

The kids card has a "✋ Ik heb een klus gedaan!" button per kid. Tapping it
opens a popup of **task buttons** (not a text box — a kid who can't read or
write well yet can still tap the task they did) drawn from the kids card's
own `groups` config (same shape and same editor UI as the parent card's task
groups, but edited independently — leave it unset to fall back to the same
default catalog). A "Iets anders" text field at the bottom covers anything
not in the list. Submitting either way creates a *pending* request — this
is the one balance-adjacent thing the kids card can do, but it never changes
a balance by itself.

Once a kid has saved up enough, a "🎁 Beloning aanvragen" button appears on
their tile too — same idea, but approving it *deducts* credits instead of
awarding them.

Every parent card shows a "📥 Verzoeken" chip with the number of pending
requests for that kid. Opening it lists each one (prefixed ✋ for a credit
request, 🎁 for a reward request) with an amount field — pre-filled with
whatever the kid's tap suggested, editable before confirming — and
**Goedkeuren**/**Afwijzen** buttons. Approving a credit request awards
credits; approving a reward request deducts them (rejecting either leaves
the balance untouched). Only a parent card can resolve a request.

The kids card also has a "N verzoeken" link per kid opening a read-only
overview of all their requests (pending/goedgekeurd/afgewezen), so a kid can
check on something they asked for without waiting on a parent.

### Push notification when a kid submits a request

The kids card's editor has a **"Pushbericht naar bij een verzoek"**
checklist, populated from your existing `notify.*` services — tick every
phone that should be pinged. The moment a kid submits a credit or reward
request, all of them get a notification naming the kid and what they're
asking for, so a parent doesn't need the dashboard open to notice.

## Services

- `kids_credits.award_points` (`kid_id`, `amount`, `reason`, optional `actor`)
- `kids_credits.deduct_points` (same fields)
- `kids_credits.redeem_reward` (same fields) — rejects the call if the kid's
  balance is below `amount`
- `kids_credits.set_kid_photo` (`kid_id`, optional `photo` as a `data:` URI —
  omit/empty to clear it back to the mdi icon)
- `kids_credits.clear_history` (`kid_id`) — wipes the ledger, resets balance
  to 0
- `kids_credits.request_credit` (`kid_id`, `reason`, optional
  `suggested_amount`) — creates a pending request, does not change the
  balance
- `kids_credits.request_reward` (`kid_id`, `reason`, `amount`) — same, for a
  reward instead of a task
- `kids_credits.approve_request` (`request_id`, `amount`, optional `actor`) —
  awards credits for a credit request, or deducts them for a reward request;
  marks the request approved
- `kids_credits.reject_request` (`request_id`, optional `actor`) — marks the
  request rejected, no balance change

`kid_id` is the slugified name shown in each entity's `kid_id` attribute
(e.g. `limanah`). These are what the cards call under the hood; you can also
call them directly from automations/scripts.
