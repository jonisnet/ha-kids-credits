from __future__ import annotations

from datetime import date as date_cls, datetime


def string(value):
    return str(value)


def date(value):
    if isinstance(value, date_cls):
        return value
    return datetime.strptime(value, "%Y-%m-%d").date()


def ensure_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]
