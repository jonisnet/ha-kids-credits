"""Constants for the Kids Credits integration."""
from __future__ import annotations

DOMAIN = "kids_credits"

STORAGE_VERSION = 1
STORAGE_KEY = "kids_credits"

DEFAULT_REWARD_THRESHOLD = 15
DEFAULT_KID_NAMES = ["Limanah", "Aline"]
DEFAULT_ICON = "mdi:account-child"

CONF_KIDS = "kids"
CONF_REWARD_THRESHOLD = "reward_threshold"

MAX_HISTORY_PER_KID = 30

CATEGORY_TASK = "task"
CATEGORY_DEDUCTION = "deduction"
CATEGORY_MANUAL = "manual"
CATEGORY_REWARD = "reward"
CATEGORIES = [CATEGORY_TASK, CATEGORY_DEDUCTION, CATEGORY_MANUAL, CATEGORY_REWARD]

SERVICE_AWARD_POINTS = "award_points"
SERVICE_DEDUCT_POINTS = "deduct_points"
SERVICE_REDEEM_REWARD = "redeem_reward"

ATTR_KID_ID = "kid_id"
ATTR_AMOUNT = "amount"
ATTR_REASON = "reason"
ATTR_CATEGORY = "category"
ATTR_ACTOR = "actor"

SIGNAL_UPDATED = f"{DOMAIN}_updated"
