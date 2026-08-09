"""The Kids Credits integration.

A simple family chore/reward point ledger: parents award or deduct credits
per kid through services (meant to be called from a parent-only Lovelace
card), kids see their own balance on a read-only card. Ships its own set of
Lovelace cards (see custom_components/kids_credits/www) that are
auto-registered as a frontend resource.
"""
from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration

from .const import CONF_KIDS, DEFAULT_KID_NAMES, DOMAIN
from .manager import KidsCreditsManager
from .services import async_register_services, async_unregister_services

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR]

FRONTEND_URL_BASE = "/kids_credits_static"
CARD_FILENAME = "kids-credits-cards.js"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})

    manager = KidsCreditsManager(hass, entry.entry_id)
    initial_kid_names = entry.options.get(CONF_KIDS, DEFAULT_KID_NAMES)
    await manager.async_setup(initial_kid_names)
    hass.data[DOMAIN][entry.entry_id] = manager

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    async_register_services(hass)
    await _async_register_frontend(hass)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if not unload_ok:
        return False

    manager: KidsCreditsManager = hass.data[DOMAIN].pop(entry.entry_id)
    await manager.async_unload()

    async_unregister_services(hass)
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Options changed (kid list or reward threshold) - resync the kid list."""
    manager: KidsCreditsManager = hass.data[DOMAIN][entry.entry_id]
    kids = entry.options.get(CONF_KIDS, DEFAULT_KID_NAMES)
    await manager.async_sync_kids(kids)


async def _async_register_frontend(hass: HomeAssistant) -> None:
    """Serve the bundled Lovelace cards and register them as a frontend resource."""
    if hass.data.get(f"{DOMAIN}_frontend_registered"):
        return
    hass.data[f"{DOMAIN}_frontend_registered"] = True

    www_path = Path(__file__).parent / "www"
    integration = await async_get_integration(hass, DOMAIN)
    # Cache-bust on the integration version so browsers/HA's frontend don't
    # keep serving a stale cached copy of the card JS after an update.
    js_url = f"{FRONTEND_URL_BASE}/{CARD_FILENAME}?v={integration.version}"

    try:
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths(
            [StaticPathConfig(FRONTEND_URL_BASE, str(www_path), cache_headers=False)]
        )
    except ImportError:
        # Older HA core versions (pre 2024.7) use the sync registration call.
        hass.http.register_static_path(FRONTEND_URL_BASE, str(www_path), cache_headers=False)

    add_extra_js_url = None
    try:
        from homeassistant.components.frontend import add_extra_js_url
    except ImportError:
        add_extra_js_url = None

    if add_extra_js_url is not None:
        add_extra_js_url(hass, js_url)

    _LOGGER.info("Kids Credits cards served at %s (add them as Lovelace resources if not auto-loaded)", js_url)
