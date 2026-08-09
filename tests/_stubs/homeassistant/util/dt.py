from __future__ import annotations

from datetime import datetime


def now() -> datetime:
    return datetime.now()


def start_of_local_day(dt=None):
    d = dt or now()
    return d.replace(hour=0, minute=0, second=0, microsecond=0)
