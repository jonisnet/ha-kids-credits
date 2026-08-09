"""Sensor platform: one credit-balance sensor per kid."""
from __future__ import annotations

import logging

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_REWARD_THRESHOLD, DEFAULT_REWARD_THRESHOLD, DOMAIN, SIGNAL_UPDATED
from .manager import KidsCreditsManager
from .models import Kid

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    manager: KidsCreditsManager = hass.data[DOMAIN][entry.entry_id]
    entities = [KidsCreditsSensor(manager, entry, kid) for kid in manager.kids.values()]
    async_add_entities(entities)

    known_kid_ids = {kid.id for kid in manager.kids.values()}

    @callback
    def _async_add_new_kids() -> None:
        new_entities = [
            KidsCreditsSensor(manager, entry, kid)
            for kid in manager.kids.values()
            if kid.id not in known_kid_ids
        ]
        if new_entities:
            known_kid_ids.update(e._kid.id for e in new_entities)
            async_add_entities(new_entities)

    entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_UPDATED}_{entry.entry_id}", _async_add_new_kids)
    )


class KidsCreditsSensor(SensorEntity):
    """The current credit balance for one kid."""

    _attr_should_poll = False
    _attr_native_unit_of_measurement = "credits"
    _attr_state_class = None

    def __init__(self, manager: KidsCreditsManager, entry: ConfigEntry, kid: Kid) -> None:
        self._manager = manager
        self._entry = entry
        self._kid = kid
        self._attr_unique_id = f"{entry.entry_id}_{kid.id}"
        self._attr_name = kid.name
        self._attr_icon = kid.icon
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"{entry.entry_id}_{kid.id}")},
            name=kid.name,
            manufacturer="Kids Credits",
            model="Beloningssysteem",
        )

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
        self._attr_name = kid.name
        self._attr_icon = kid.icon
        self.async_write_ha_state()

    @property
    def native_value(self) -> int:
        return self._manager.balance(self._kid.id)

    @property
    def extra_state_attributes(self) -> dict:
        threshold = self._entry.options.get(CONF_REWARD_THRESHOLD, DEFAULT_REWARD_THRESHOLD)
        balance = self._manager.balance(self._kid.id)
        return {
            "kid_id": self._kid.id,
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
        }
