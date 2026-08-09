"""Minimal re-implementation of homeassistant.util.slugify for offline tests.

Matches real HA behaviour closely enough for our purposes: unicode
transliteration, lowercase, non [a-z0-9] runs collapsed to a single
underscore, stripped at the edges.
"""
from __future__ import annotations

import re
import unicodedata


def slugify(text: str) -> str:
    if not text:
        return ""
    normalized = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    normalized = normalized.lower()
    return re.sub(r"[^a-z0-9]+", "_", normalized).strip("_")
