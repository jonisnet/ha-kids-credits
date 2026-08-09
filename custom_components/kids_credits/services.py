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
    ATTR_PHOTO,
    ATTR_REASON,
    ATTR_REQUEST_ID,
    DOMAIN,
    SERVICE_APPROVE_REQUEST,
    SERVICE_AWARD_POINTS,
    SERVICE_DEDUCT_POINTS,
    SERVICE_REDEEM_REWARD,
    SERVICE_REJECT_REQUEST,
    SERVICE_REQUEST_CREDIT,
    SERVICE_SET_KID_PHOTO,
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

_SET_PHOTO_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_KID_ID): cv.string,
        vol.Optional(ATTR_PHOTO, default=""): cv.string,
    }
)

_REQUEST_CREDIT_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_KID_ID): cv.string,
        vol.Required(ATTR_REASON): cv.string,
    }
)

_APPROVE_REQUEST_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_REQUEST_ID): cv.string,
        vol.Required(ATTR_AMOUNT): vol.All(vol.Coerce(int), vol.Range(min=1)),
        vol.Optional(ATTR_ACTOR): cv.string,
    }
)

_REJECT_REQUEST_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_REQUEST_ID): cv.string,
        vol.Optional(ATTR_ACTOR): cv.string,
    }
)


def _get_manager(hass: HomeAssistant, kid_id: str) -> KidsCreditsManager:
    for manager in hass.data.get(DOMAIN, {}).values():
        if kid_id in manager.kids:
            return manager
    raise ServiceValidationError(f"Unknown kid_id: {kid_id}")


def _get_manager_for_request(hass: HomeAssistant, request_id: str) -> KidsCreditsManager:
    for manager in hass.data.get(DOMAIN, {}).values():
        if any(r.id == request_id for r in manager.requests):
            return manager
    raise ServiceValidationError(f"Unknown request_id: {request_id}")


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

    async def _set_photo(call: ServiceCall) -> None:
        manager = _get_manager(hass, call.data[ATTR_KID_ID])
        await manager.async_set_photo(call.data[ATTR_KID_ID], call.data.get(ATTR_PHOTO) or None)

    async def _request_credit(call: ServiceCall) -> None:
        manager = _get_manager(hass, call.data[ATTR_KID_ID])
        await manager.async_request_credit(call.data[ATTR_KID_ID], call.data[ATTR_REASON])

    async def _approve_request(call: ServiceCall) -> None:
        manager = _get_manager_for_request(hass, call.data[ATTR_REQUEST_ID])
        await manager.async_approve_request(
            call.data[ATTR_REQUEST_ID], call.data[ATTR_AMOUNT], call.data.get(ATTR_ACTOR)
        )

    async def _reject_request(call: ServiceCall) -> None:
        manager = _get_manager_for_request(hass, call.data[ATTR_REQUEST_ID])
        await manager.async_reject_request(call.data[ATTR_REQUEST_ID], call.data.get(ATTR_ACTOR))

    hass.services.async_register(DOMAIN, SERVICE_AWARD_POINTS, _award, schema=_POINTS_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_DEDUCT_POINTS, _deduct, schema=_POINTS_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_REDEEM_REWARD, _redeem, schema=_POINTS_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_SET_KID_PHOTO, _set_photo, schema=_SET_PHOTO_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_REQUEST_CREDIT, _request_credit, schema=_REQUEST_CREDIT_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_APPROVE_REQUEST, _approve_request, schema=_APPROVE_REQUEST_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_REJECT_REQUEST, _reject_request, schema=_REJECT_REQUEST_SCHEMA)


def async_unregister_services(hass: HomeAssistant) -> None:
    if hass.data.get(DOMAIN):
        return  # other config entries (shouldn't normally happen, single-instance) still need them
    hass.services.async_remove(DOMAIN, SERVICE_AWARD_POINTS)
    hass.services.async_remove(DOMAIN, SERVICE_DEDUCT_POINTS)
    hass.services.async_remove(DOMAIN, SERVICE_REDEEM_REWARD)
    hass.services.async_remove(DOMAIN, SERVICE_SET_KID_PHOTO)
    hass.services.async_remove(DOMAIN, SERVICE_REQUEST_CREDIT)
    hass.services.async_remove(DOMAIN, SERVICE_APPROVE_REQUEST)
    hass.services.async_remove(DOMAIN, SERVICE_REJECT_REQUEST)
