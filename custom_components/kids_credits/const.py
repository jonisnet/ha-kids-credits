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
MAX_REQUESTS_PER_KID = 30

CATEGORY_TASK = "task"
CATEGORY_DEDUCTION = "deduction"
CATEGORY_MANUAL = "manual"
CATEGORY_REWARD = "reward"
CATEGORIES = [CATEGORY_TASK, CATEGORY_DEDUCTION, CATEGORY_MANUAL, CATEGORY_REWARD]

SERVICE_AWARD_POINTS = "award_points"
SERVICE_DEDUCT_POINTS = "deduct_points"
SERVICE_REDEEM_REWARD = "redeem_reward"
SERVICE_SET_KID_PHOTO = "set_kid_photo"
SERVICE_REQUEST_CREDIT = "request_credit"
SERVICE_REQUEST_REWARD = "request_reward"
SERVICE_APPROVE_REQUEST = "approve_request"
SERVICE_REJECT_REQUEST = "reject_request"
SERVICE_CLEAR_HISTORY = "clear_history"

ATTR_KID_ID = "kid_id"
ATTR_AMOUNT = "amount"
ATTR_REASON = "reason"
ATTR_CATEGORY = "category"
ATTR_ACTOR = "actor"
ATTR_PHOTO = "photo"
ATTR_REQUEST_ID = "request_id"
ATTR_SUGGESTED_AMOUNT = "suggested_amount"

# A generous cap on the uploaded photo's data: URI length, just to stop an
# accidental multi-megabyte upload from bloating the storage JSON file
# indefinitely - not a strict product requirement.
MAX_PHOTO_DATA_URI_LENGTH = 400_000

SIGNAL_UPDATED = f"{DOMAIN}_updated"
