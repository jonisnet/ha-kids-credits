"""The 'kids_credits' platform of the kids_credits integration.

This looks circular, but it's the standard way for an integration to have
entities directly under its own domain (kids_credits.<kid_id> instead of
sensor.<kid_id>) - matching a platform-name-equals-component-name lookup.
Loaded via EntityComponent.async_setup_entry() in __init__.py, NOT via
hass.config_entries.async_forward_entry_setups() - that call would treat
"forward to a platform whose domain equals the integration's own domain" as
re-entering the entry's own setup and reject it. Either way, this module
receives a real, config-entry-bound async_add_entities callback, so the
resulting entities are correctly tied to the config entry.
"""
from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_REWARD_THRESHOLD, DEFAULT_REWARD_THRESHOLD, DOMAIN, SIGNAL_UPDATED
from .manager import KidsCreditsManager
from .models import Kid

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    manager: KidsCreditsManager = hass.data[DOMAIN][entry.entry_id]
    entities = [KidsCreditsEntity(manager, entry, kid) for kid in manager.kids.values()]
    async_add_entities(entities)

    known_kid_ids = {kid.id for kid in manager.kids.values()}

    @callback
    def _async_add_new_kids() -> None:
        new_entities = [
            KidsCreditsEntity(manager, entry, kid)
            for kid in manager.kids.values()
            if kid.id not in known_kid_ids
        ]
        if new_entities:
            known_kid_ids.update(e._kid.id for e in new_entities)
            async_add_entities(new_entities)

    entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_UPDATED}_{entry.entry_id}", _async_add_new_kids)
    )


class KidsCreditsEntity(Entity):
    """The current credit balance for one kid, as a kids_credits.<kid_id> entity.

    No device_info here (deliberately, matching the same fix life_events
    needed): "legacy naming" (has_entity_name False) entities linked to a
    device get "<device name> <entity name>" computed as their friendly_name
    regardless of has_entity_name, which would mangle every kid's name.
    Being tied to the config entry (via EntityComponent in __init__.py) is
    what makes entities show up under Settings -> Devices & services ->
    Kids Credits; that doesn't require a device.
    """

    should_poll = False
    _attr_has_entity_name = False

    def __init__(self, manager: KidsCreditsManager, entry: ConfigEntry, kid: Kid) -> None:
        self._manager = manager
        self._entry = entry
        self._kid = kid
        self.entity_id = f"{DOMAIN}.{kid.id}"

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass, f"{SIGNAL_UPDATED}_{self._entry.entry_id}", self._async_on_update
            )
        )

    @callback
    def _async_on_update(self) -> None:
        kid = self._manager.kids.get(self._kid.id)
        if kid is None:
            return  # kid was removed from the config; entity lingers until HA restarts
        self._kid = kid
        self.async_write_ha_state()

    @property
    def unique_id(self) -> str:
        return f"{self._entry.entry_id}_{self._kid.id}"

    @property
    def name(self) -> str | None:
        return self._kid.name

    @property
    def icon(self) -> str | None:
        return self._kid.icon

    @property
    def state(self) -> int:
        return self._manager.balance(self._kid.id)

    @property
    def unit_of_measurement(self) -> str | None:
        return "credits"

    @property
    def extra_state_attributes(self) -> dict:
        threshold = self._entry.options.get(CONF_REWARD_THRESHOLD, DEFAULT_REWARD_THRESHOLD)
        balance = self._manager.balance(self._kid.id)
        return {
            "kid_id": self._kid.id,
            "photo": self._kid.photo,
            "reward_threshold": threshold,
            "credits_until_reward": max(threshold - balance, 0),
            "reward_available": balance >= threshold,
            "lifetime_earned": self._manager.lifetime_earned(self._kid.id),
            "lifetime_deducted": self._manager.lifetime_deducted(self._kid.id),
            "history": [
                {
                    "delta": e.delta,
                    "reason": e.reason,
                    "category": e.category,
                    "created_at": e.created_at,
                    "actor": e.actor,
                }
                for e in self._manager.history(self._kid.id)
            ],
            "requests": [
                {
                    "id": r.id,
                    "kind": r.kind,
                    "reason": r.reason,
                    "status": r.status,
                    "created_at": r.created_at,
                    "resolved_at": r.resolved_at,
                    "actor": r.actor,
                    "amount": r.amount,
                    "suggested_amount": r.suggested_amount,
                }
                for r in self._manager.requests_for(self._kid.id)
            ],
        }
