"""Data models for the Kids Credits integration."""
from __future__ import annotations

from dataclasses import dataclass, field
import re
import time
import uuid


def slugify_id(name: str) -> str:
    """Turn a kid's name into a stable, storage-safe id."""
    slug = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return slug or uuid.uuid4().hex[:8]


@dataclass
class Kid:
    id: str
    name: str
    icon: str = "mdi:account-child"
    photo: str | None = None  # data: URI, uploaded via the parent card

    @classmethod
    def from_storage_dict(cls, raw: dict) -> "Kid":
        return cls(
            id=raw["id"],
            name=raw["name"],
            icon=raw.get("icon", "mdi:account-child"),
            photo=raw.get("photo"),
        )

    def to_storage_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "icon": self.icon, "photo": self.photo}


@dataclass
class LedgerEntry:
    id: str
    kid_id: str
    delta: int
    reason: str
    category: str
    created_at: float = field(default_factory=time.time)
    actor: str | None = None

    @classmethod
    def from_storage_dict(cls, raw: dict) -> "LedgerEntry":
        return cls(
            id=raw["id"],
            kid_id=raw["kid_id"],
            delta=int(raw["delta"]),
            reason=raw.get("reason", ""),
            category=raw.get("category", "manual"),
            created_at=float(raw.get("created_at", time.time())),
            actor=raw.get("actor"),
        )

    def to_storage_dict(self) -> dict:
        return {
            "id": self.id,
            "kid_id": self.kid_id,
            "delta": self.delta,
            "reason": self.reason,
            "category": self.category,
            "created_at": self.created_at,
            "actor": self.actor,
        }


STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"


@dataclass
class CreditRequest:
    id: str
    kid_id: str
    reason: str
    status: str = STATUS_PENDING
    created_at: float = field(default_factory=time.time)
    resolved_at: float | None = None
    actor: str | None = None
    amount: int | None = None

    @classmethod
    def from_storage_dict(cls, raw: dict) -> "CreditRequest":
        return cls(
            id=raw["id"],
            kid_id=raw["kid_id"],
            reason=raw.get("reason", ""),
            status=raw.get("status", STATUS_PENDING),
            created_at=float(raw.get("created_at", time.time())),
            resolved_at=float(raw["resolved_at"]) if raw.get("resolved_at") is not None else None,
            actor=raw.get("actor"),
            amount=raw.get("amount"),
        )

    def to_storage_dict(self) -> dict:
        return {
            "id": self.id,
            "kid_id": self.kid_id,
            "reason": self.reason,
            "status": self.status,
            "created_at": self.created_at,
            "resolved_at": self.resolved_at,
            "actor": self.actor,
            "amount": self.amount,
        }


def new_entry_id() -> str:
    return uuid.uuid4().hex
