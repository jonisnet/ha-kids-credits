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
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_component import EntityComponent
from homeassistant.loader import async_get_integration

from .const import CONF_KIDS, DEFAULT_KID_NAMES, DOMAIN
from .manager import KidsCreditsManager
from .services import async_register_services, async_unregister_services

_LOGGER = logging.getLogger(__name__)

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

    # Entities live directly in the kids_credits domain (kids_credits.*
    # entity_ids, not sensor.*). That can't go through
    # hass.config_entries.async_forward_entry_setups(entry, [DOMAIN]):
    # ConfigEntry.async_setup() treats "forward to a platform whose domain
    # equals the integration's own domain" as re-entering this very entry's
    # setup and raises OperationNotAllowed. EntityComponent.async_setup_entry()
    # is the mechanism HA itself uses for entities that live under their own
    # integration's domain - it builds the config-entry-bound EntityPlatform
    # and loads our kids_credits.py platform module directly, without going
    # through that reentrancy-guarded path. (Same pattern already proven in
    # the ha-life-events integration.)
    component = EntityComponent(_LOGGER, DOMAIN, hass)
    hass.data[f"{DOMAIN}_component"] = component
    if not await component.async_setup_entry(entry):
        return False

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    component: EntityComponent = hass.data.pop(f"{DOMAIN}_component")
    if not await component.async_unload_entry(entry):
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
