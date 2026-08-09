"""Services: award_points, deduct_points, redeem_reward."""
from __future__ import annotations

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall
import homeassistant.helpers.config_validation as cv
from homeassistant.exceptions import ServiceValidationError

from .const import (
    ATTR_ACTOR,
    ATTR_AMOUNT,
    ATTR_KID_ID,
    ATTR_REASON,
    DOMAIN,
    SERVICE_AWARD_POINTS,
    SERVICE_DEDUCT_POINTS,
    SERVICE_REDEEM_REWARD,
)
from .manager import KidsCreditsManager

_POINTS_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_KID_ID): cv.string,
        vol.Required(ATTR_AMOUNT): vol.All(vol.Coerce(int), vol.Range(min=1)),
        vol.Required(ATTR_REASON): cv.string,
        vol.Optional(ATTR_ACTOR): cv.string,
    }
)


def _get_manager(hass: HomeAssistant, kid_id: str) -> KidsCreditsManager:
    for manager in hass.data.get(DOMAIN, {}).values():
        if kid_id in manager.kids:
            return manager
    raise ServiceValidationError(f"Unknown kid_id: {kid_id}")


def async_register_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_AWARD_POINTS):
        return

    async def _award(call: ServiceCall) -> None:
        manager = _get_manager(hass, call.data[ATTR_KID_ID])
        await manager.async_award(
            call.data[ATTR_KID_ID], call.data[ATTR_AMOUNT], call.data[ATTR_REASON], call.data.get(ATTR_ACTOR)
        )

    async def _deduct(call: ServiceCall) -> None:
        manager = _get_manager(hass, call.data[ATTR_KID_ID])
        await manager.async_deduct(
            call.data[ATTR_KID_ID], call.data[ATTR_AMOUNT], call.data[ATTR_REASON], call.data.get(ATTR_ACTOR)
        )

    async def _redeem(call: ServiceCall) -> None:
        manager = _get_manager(hass, call.data[ATTR_KID_ID])
        await manager.async_redeem(
            call.data[ATTR_KID_ID], call.data[ATTR_AMOUNT], call.data[ATTR_REASON], call.data.get(ATTR_ACTOR)
        )

    hass.services.async_register(DOMAIN, SERVICE_AWARD_POINTS, _award, schema=_POINTS_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_DEDUCT_POINTS, _deduct, schema=_POINTS_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_REDEEM_REWARD, _redeem, schema=_POINTS_SCHEMA)


def async_unregister_services(hass: HomeAssistant) -> None:
    if hass.data.get(DOMAIN):
        return  # other config entries (shouldn't normally happen, single-instance) still need them
    hass.services.async_remove(DOMAIN, SERVICE_AWARD_POINTS)
    hass.services.async_remove(DOMAIN, SERVICE_DEDUCT_POINTS)
    hass.services.async_remove(DOMAIN, SERVICE_REDEEM_REWARD)
