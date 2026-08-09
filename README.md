# Kids Credits

A simple family chore/reward credit system for Home Assistant. Parents award
or deduct credits per kid (per completed task, or freeform with a reason);
kids see their own balance on a read-only dashboard. Ships its own Lovelace
cards, no YAML card config required beyond adding them to a view.

## Why two cards, not one

- `kids-credits-parent-card` — task buttons, manual +/-, deduction buttons,
  reward redemption, recent history. Put this only on a dashboard parents
  see (your own phones, an admin-only view).
- `kids-credits-kids-card` — read-only balance + progress bar per kid, no
  service calls at all. Meant for a shared kids tablet.

There is no login/permission system inside the integration itself — "only
parents can change credits" is enforced simply by which dashboard/device the
parent card is shown on. See [dashboards/kids_credits.yaml](dashboards/kids_credits.yaml)
for an example split into an "Ouders" and a "Kinderen" view.

## Installation

### HACS (custom repository)

1. Go to integrations
2. Press the dotted menu in the top right corner
3. Choose custom repositories
4. Add the URL to this repository, category `Integration`
5. Install, restart Home Assistant

### Manual

Copy `custom_components/kids_credits` into your Home Assistant `custom_components/` folder and restart.

## Setup

Settings → Devices & Services → Add integration → **Kids Credits**. You'll be asked for:

- **Kids** — comma-separated names, e.g. `Limanah, Aline`
- **Credits for a reward** — default `15`, matching the family's own rule

Both are editable later via the integration's **Configure** button. Renaming
a kid in that field creates a *new* kid with fresh history — it does not
rename the existing one in place.

Each kid gets one `sensor.<name>` entity: its state is the current balance,
with attributes `reward_threshold`, `credits_until_reward`,
`reward_available`, `lifetime_earned`, `lifetime_deducted`, and a `history`
list of the most recent ledger entries.

## Dashboards

Add the two views from [dashboards/kids_credits.yaml](dashboards/kids_credits.yaml)
(or just the individual `custom:kids-credits-parent-card` /
`custom:kids-credits-kids-card` cards) to your own dashboards.

## Task list / point values

The parent card's task buttons are transcribed directly from the family's
"zelfstandigheids beloningen" document: 2/3/5-credit tasks, a 1-credit
household rota, and a reward at 15 credits by default. The document did
**not** specify how many credits to deduct for each item under "credits in
mindering" (hitting/kicking, not clearing dishes, etc.) — those default to 1
credit and have a small +/- stepper next to them so you can adjust the
amount per click without it being silently guessed.

To change the task list or point values, edit `TASK_GROUPS` / `DEDUCTIONS`
near the top of
[custom_components/kids_credits/www/kids-credits-cards.js](custom_components/kids_credits/www/kids-credits-cards.js).

## Services

- `kids_credits.award_points` (`kid_id`, `amount`, `reason`, optional `actor`)
- `kids_credits.deduct_points` (same fields)
- `kids_credits.redeem_reward` (same fields) — rejects the call if the kid's
  balance is below `amount`

`kid_id` is the slugified name shown in each sensor's `kid_id` attribute
(e.g. `limanah`). These are what the parent card's buttons call under the
hood; you can also call them directly from automations/scripts.
