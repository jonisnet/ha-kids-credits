"""Runtime manager: holds kids + the credit ledger for one config entry."""
from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import DEFAULT_ICON, MAX_HISTORY_PER_KID, SIGNAL_UPDATED
from .models import Kid, LedgerEntry, new_entry_id, slugify_id
from .store import KidsCreditsStore

_LOGGER = logging.getLogger(__name__)


class KidsCreditsManager:
    """Owns the kid list and the append-only credit ledger for one config entry."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self._store = KidsCreditsStore(hass, entry_id)
        self.kids: dict[str, Kid] = {}
        self.entries: list[LedgerEntry] = []

    async def async_setup(self, initial_kid_names: list[str] | None = None) -> None:
        kids, entries = await self._store.async_load()
        if not kids and initial_kid_names:
            kids = [Kid(id=slugify_id(name), name=name, icon=DEFAULT_ICON) for name in initial_kid_names]
        self.kids = {k.id: k for k in kids}
        self.entries = entries
        if not kids:
            return
        await self._store.async_save(list(self.kids.values()), self.entries)

    async def async_unload(self) -> None:
        return None

    def balance(self, kid_id: str) -> int:
        return sum(e.delta for e in self.entries if e.kid_id == kid_id)

    def lifetime_earned(self, kid_id: str) -> int:
        return sum(e.delta for e in self.entries if e.kid_id == kid_id and e.delta > 0)

    def lifetime_deducted(self, kid_id: str) -> int:
        return -sum(e.delta for e in self.entries if e.kid_id == kid_id and e.delta < 0)

    def history(self, kid_id: str, limit: int = MAX_HISTORY_PER_KID) -> list[LedgerEntry]:
        kid_entries = [e for e in self.entries if e.kid_id == kid_id]
        kid_entries.sort(key=lambda e: e.created_at, reverse=True)
        return kid_entries[:limit]

    def get_kid(self, kid_id: str) -> Kid:
        kid = self.kids.get(kid_id)
        if kid is None:
            raise ServiceValidationError(f"Unknown kid_id: {kid_id}")
        return kid

    async def async_sync_kids(self, names: list[str]) -> None:
        """Reconcile the kid list against a plain list of names (from the options flow).

        Matching is by name: an existing kid whose name is unchanged keeps its id
        (and therefore its ledger history); a new name gets a freshly slugified id.
        Kids removed from the list keep their ledger entries in storage (orphaned,
        not deleted) so re-adding the same name later restores their history.
        """
        existing_by_name = {k.name: k for k in self.kids.values()}
        new_kids: dict[str, Kid] = {}
        for name in names:
            name = name.strip()
            if not name:
                continue
            existing = existing_by_name.get(name)
            if existing:
                new_kids[existing.id] = existing
            else:
                kid_id = slugify_id(name)
                new_kids[kid_id] = Kid(id=kid_id, name=name, icon=DEFAULT_ICON)
        self.kids = new_kids
        await self._store.async_save(list(self.kids.values()), self.entries)
        async_dispatcher_send(self.hass, f"{SIGNAL_UPDATED}_{self.entry_id}")

    async def async_add_entry(self, kid_id: str, delta: int, reason: str, category: str, actor: str | None) -> LedgerEntry:
        self.get_kid(kid_id)  # raises if unknown
        entry = LedgerEntry(
            id=new_entry_id(), kid_id=kid_id, delta=delta, reason=reason, category=category, actor=actor
        )
        self.entries.append(entry)
        await self._store.async_save(list(self.kids.values()), self.entries)
        async_dispatcher_send(self.hass, f"{SIGNAL_UPDATED}_{self.entry_id}")
        return entry

    async def async_award(self, kid_id: str, amount: int, reason: str, actor: str | None) -> LedgerEntry:
        if amount <= 0:
            raise ServiceValidationError("amount must be a positive number of credits")
        return await self.async_add_entry(kid_id, amount, reason, "task", actor)

    async def async_deduct(self, kid_id: str, amount: int, reason: str, actor: str | None) -> LedgerEntry:
        if amount <= 0:
            raise ServiceValidationError("amount must be a positive number of credits")
        return await self.async_add_entry(kid_id, -amount, reason, "deduction", actor)

    async def async_redeem(self, kid_id: str, amount: int, reason: str, actor: str | None) -> LedgerEntry:
        if amount <= 0:
            raise ServiceValidationError("amount must be a positive number of credits")
        if self.balance(kid_id) < amount:
            kid = self.get_kid(kid_id)
            raise ServiceValidationError(
                f"{kid.name} heeft maar {self.balance(kid_id)} credits, {amount} nodig voor deze beloning"
            )
        return await self.async_add_entry(kid_id, -amount, reason, "reward", actor)
