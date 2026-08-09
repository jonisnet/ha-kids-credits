"""Persistent storage for kids and their credit ledger."""
from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import STORAGE_KEY, STORAGE_VERSION
from .models import Kid, LedgerEntry

_LOGGER = logging.getLogger(__name__)


class KidsCreditsStore:
    """Wraps HA's Store helper to persist kids + ledger entries for one config entry."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._store = Store(hass, STORAGE_VERSION, f"{STORAGE_KEY}_{entry_id}")

    async def async_load(self) -> tuple[list[Kid], list[LedgerEntry]]:
        raw = await self._store.async_load()
        if not raw:
            return [], []

        kids = []
        for raw_kid in raw.get("kids", []):
            try:
                kids.append(Kid.from_storage_dict(raw_kid))
            except (KeyError, ValueError) as err:
                _LOGGER.warning("Skipping invalid stored kid %s: %s", raw_kid, err)

        entries = []
        for raw_entry in raw.get("entries", []):
            try:
                entries.append(LedgerEntry.from_storage_dict(raw_entry))
            except (KeyError, ValueError) as err:
                _LOGGER.warning("Skipping invalid stored ledger entry %s: %s", raw_entry, err)

        return kids, entries

    async def async_save(self, kids: list[Kid], entries: list[LedgerEntry]) -> None:
        await self._store.async_save(
            {
                "kids": [k.to_storage_dict() for k in kids],
                "entries": [e.to_storage_dict() for e in entries],
            }
        )
