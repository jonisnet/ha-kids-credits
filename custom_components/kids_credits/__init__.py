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
from .frontend import KidsCreditsCardView, LovelaceResourceRegistration
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

    # Deliberately does NOT clear hass.data[f"{DOMAIN}_frontend_registered"]
    # or unregister the static path - both are idempotent-per-hass-lifetime
    # and safe to leave registered across a reload; re-registering the
    # static path a second time raises. The Lovelace resource entry itself
    # is fine to leave in place too (a reload isn't an uninstall) - only a
    # real removal should delete it, which isn't something this integration
    # can distinguish from a reload here, so it's left alone.

    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Options changed (kid list or reward threshold) - resync the kid list."""
    manager: KidsCreditsManager = hass.data[DOMAIN][entry.entry_id]
    kids = entry.options.get(CONF_KIDS, DEFAULT_KID_NAMES)
    await manager.async_sync_kids(kids)


async def _async_register_frontend(hass: HomeAssistant) -> None:
    """Serve the bundled Lovelace card JS and register it as a frontend resource."""
    if hass.data.get(f"{DOMAIN}_frontend_registered"):
        return
    hass.data[f"{DOMAIN}_frontend_registered"] = True

    www_path = Path(__file__).parent / "www"
    integration = await async_get_integration(hass, DOMAIN)
    js_path = f"{FRONTEND_URL_BASE}/{CARD_FILENAME}"

    # A dedicated view instead of a static-path registration - it's the only
    # way to force Cache-Control: no-store on this one file (see
    # frontend.py's docstring for why that matters more than the resource
    # URL's own version-bump).
    hass.http.register_view(KidsCreditsCardView(js_path, www_path / CARD_FILENAME))

    # Prefer registering as a real Lovelace resource (see frontend.py for
    # why) - only fall back to the always-works-but-cache-flaky
    # add_extra_js_url injection if that isn't possible right now.
    registered_as_resource = await LovelaceResourceRegistration(hass, js_path).async_try_register(
        integration.version
    )

    if not registered_as_resource:
        js_url = f"{js_path}?v={integration.version}"
        try:
            from homeassistant.components.frontend import add_extra_js_url

            add_extra_js_url(hass, js_url)
        except ImportError:
            pass

    _LOGGER.info(
        "Kids Credits cards served at %s (registered as a Lovelace resource: %s)",
        js_path,
        registered_as_resource,
    )
