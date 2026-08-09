"""Runtime manager: holds kids, the credit ledger and credit requests for one config entry."""
from __future__ import annotations

import logging
import time

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import (
    DEFAULT_ICON,
    MAX_HISTORY_PER_KID,
    MAX_PHOTO_DATA_URI_LENGTH,
    MAX_REQUESTS_PER_KID,
    SIGNAL_UPDATED,
)
from .models import (
    REQUEST_KIND_REWARD,
    STATUS_APPROVED,
    STATUS_PENDING,
    STATUS_REJECTED,
    CreditRequest,
    Kid,
    LedgerEntry,
    new_entry_id,
    slugify_id,
)
from .store import KidsCreditsStore

_LOGGER = logging.getLogger(__name__)


class KidsCreditsManager:
    """Owns the kid list, the append-only credit ledger, and pending/resolved
    credit requests for one config entry."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self._store = KidsCreditsStore(hass, entry_id)
        self.kids: dict[str, Kid] = {}
        self.entries: list[LedgerEntry] = []
        self.requests: list[CreditRequest] = []

    async def async_setup(self, initial_kid_names: list[str] | None = None) -> None:
        kids, entries, requests = await self._store.async_load()
        if not kids and initial_kid_names:
            kids = [Kid(id=slugify_id(name), name=name, icon=DEFAULT_ICON) for name in initial_kid_names]
        self.kids = {k.id: k for k in kids}
        self.entries = entries
        self.requests = requests
        if not kids:
            return
        await self._persist()

    async def async_unload(self) -> None:
        return None

    async def _persist(self) -> None:
        await self._store.async_save(list(self.kids.values()), self.entries, self.requests)

    def _notify(self) -> None:
        async_dispatcher_send(self.hass, f"{SIGNAL_UPDATED}_{self.entry_id}")

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

    def requests_for(self, kid_id: str, limit: int = MAX_REQUESTS_PER_KID) -> list[CreditRequest]:
        kid_requests = [r for r in self.requests if r.kid_id == kid_id]
        kid_requests.sort(key=lambda r: r.created_at, reverse=True)
        return kid_requests[:limit]

    def get_kid(self, kid_id: str) -> Kid:
        kid = self.kids.get(kid_id)
        if kid is None:
            raise ServiceValidationError(f"Unknown kid_id: {kid_id}")
        return kid

    def get_request(self, request_id: str) -> CreditRequest:
        for request in self.requests:
            if request.id == request_id:
                return request
        raise ServiceValidationError(f"Unknown request_id: {request_id}")

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
        await self._persist()
        self._notify()

    async def async_add_entry(self, kid_id: str, delta: int, reason: str, category: str, actor: str | None) -> LedgerEntry:
        self.get_kid(kid_id)  # raises if unknown
        entry = LedgerEntry(
            id=new_entry_id(), kid_id=kid_id, delta=delta, reason=reason, category=category, actor=actor
        )
        self.entries.append(entry)
        await self._persist()
        self._notify()
        return entry

    async def async_award(self, kid_id: str, amount: int, reason: str, actor: str | None) -> LedgerEntry:
        if amount <= 0:
            raise ServiceValidationError("amount must be a positive number of credits")
        return await self.async_add_entry(kid_id, amount, reason, "task", actor)

    async def async_deduct(self, kid_id: str, amount: int, reason: str, actor: str | None) -> LedgerEntry:
        if amount <= 0:
            raise ServiceValidationError("amount must be a positive number of credits")
        return await self.async_add_entry(kid_id, -amount, reason, "deduction", actor)

    async def async_clear_history(self, kid_id: str) -> None:
        """Wipes every ledger entry for this kid - since balance is purely the
        sum of entries, this also resets their balance back to 0. There is no
        way to clear the history log while keeping the balance; the editor's
        confirm step must make that consequence clear before calling this."""
        self.get_kid(kid_id)  # raises if unknown
        self.entries = [e for e in self.entries if e.kid_id != kid_id]
        await self._persist()
        self._notify()

    async def async_set_photo(self, kid_id: str, photo: str | None) -> None:
        kid = self.get_kid(kid_id)
        if photo and len(photo) > MAX_PHOTO_DATA_URI_LENGTH:
            raise ServiceValidationError("Foto is te groot, kies een kleinere afbeelding")
        kid.photo = photo or None
        await self._persist()
        self._notify()

    async def async_redeem(self, kid_id: str, amount: int, reason: str, actor: str | None) -> LedgerEntry:
        if amount <= 0:
            raise ServiceValidationError("amount must be a positive number of credits")
        if self.balance(kid_id) < amount:
            kid = self.get_kid(kid_id)
            raise ServiceValidationError(
                f"{kid.name} heeft maar {self.balance(kid_id)} credits, {amount} nodig voor deze beloning"
            )
        return await self.async_add_entry(kid_id, -amount, reason, "reward", actor)

    async def async_request_credit(
        self, kid_id: str, reason: str, suggested_amount: int | None = None
    ) -> CreditRequest:
        """A kid asks for credit for a task they say they completed. Creates a
        pending request only - no credits change hands until a parent approves it.
        `suggested_amount` (e.g. from tapping a known task button) is only ever a
        pre-fill hint for the parent's approval amount, never authoritative."""
        self.get_kid(kid_id)  # raises if unknown
        request = CreditRequest(id=new_entry_id(), kid_id=kid_id, reason=reason, suggested_amount=suggested_amount)
        self.requests.append(request)
        await self._persist()
        self._notify()
        return request

    async def async_request_reward(self, kid_id: str, reason: str, amount: int) -> CreditRequest:
        """A kid asks to redeem a reward they've saved up enough credits for.
        Creates a pending request only - a parent must still approve it before
        any credits are actually deducted."""
        self.get_kid(kid_id)  # raises if unknown
        if amount <= 0:
            raise ServiceValidationError("amount must be a positive number of credits")
        request = CreditRequest(
            id=new_entry_id(), kid_id=kid_id, reason=reason, kind=REQUEST_KIND_REWARD, suggested_amount=amount
        )
        self.requests.append(request)
        await self._persist()
        self._notify()
        return request

    async def async_approve_request(self, request_id: str, amount: int, actor: str | None) -> CreditRequest:
        if amount <= 0:
            raise ServiceValidationError("amount must be a positive number of credits")
        request = self.get_request(request_id)
        if request.status != STATUS_PENDING:
            raise ServiceValidationError(f"Verzoek is al {request.status}")
        self.get_kid(request.kid_id)  # raises if unknown

        if request.kind == REQUEST_KIND_REWARD:
            if self.balance(request.kid_id) < amount:
                kid = self.get_kid(request.kid_id)
                raise ServiceValidationError(
                    f"{kid.name} heeft maar {self.balance(request.kid_id)} credits, {amount} nodig voor deze beloning"
                )
            delta, category = -amount, "reward"
        else:
            delta, category = amount, "task"

        self.entries.append(
            LedgerEntry(
                id=new_entry_id(), kid_id=request.kid_id, delta=delta, reason=request.reason,
                category=category, actor=actor,
            )
        )
        request.status = STATUS_APPROVED
        request.amount = amount
        request.actor = actor
        request.resolved_at = time.time()
        await self._persist()
        self._notify()
        return request

    async def async_reject_request(self, request_id: str, actor: str | None) -> CreditRequest:
        request = self.get_request(request_id)
        if request.status != STATUS_PENDING:
            raise ServiceValidationError(f"Verzoek is al {request.status}")
        request.status = STATUS_REJECTED
        request.actor = actor
        request.resolved_at = time.time()
        await self._persist()
        self._notify()
        return request
