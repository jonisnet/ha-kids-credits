"""Registers the card JS as a real Lovelace resource, not via add_extra_js_url,
and serves the file itself with caching turned off outright.

`add_extra_js_url` injects the script tag fresh on every frontend page load
from an in-memory list - it works, but several HACS integrations that use
it (this one included) have had users report the card/its icons "getting
stuck" after an update until a manual browser hard-refresh or Companion App
"reset frontend cache". A resource added the normal way (Settings ->
Dashboards -> Resources, or what HACS itself does for "Plugin"-category
repos) does not have that problem - it goes through Lovelace's own
resources storage collection, the same code path the "Add Resource" dialog
uses.

This mirrors that: create/update our entry in `lovelace.resources` directly
via its public async_create_item/async_update_item methods (the same ones
the resource-editing UI calls). This touches `hass.data["lovelace"]`, which
is an internal object, not a documented `homeassistant.helpers` API -
there's no dedicated public API for a third-party integration to do this.
If anything about its shape doesn't match what's expected (a future
HA-core change, or YAML-mode dashboards), this fails soft and the caller
falls back to the add_extra_js_url injection - never a crash, just a less
reliable fallback (see _async_register_frontend's docstring for why it's
less reliable).

Historical note - a real bug this docstring used to describe as intended
behavior: this class used to check `lovelace.mode` (no such attribute -
current HA core's `LovelaceData` dataclass calls it `resource_mode`) and
bail out whenever `lovelace.resources.loaded` was still False, deliberately,
"to not block config entry setup". Both were wrong. The attribute typo
meant every single call raised AttributeError and silently fell back to
add_extra_js_url, unconditionally - not "rarely, early in startup" as the
old comment claimed, but always. And the `.loaded` pre-check was solving a
problem `ResourceStorageCollection` already solves better itself:
`async_create_item`/`async_update_item` call `_async_ensure_loaded()`
internally and await the real load before doing anything, so bailing out
"because it might not be loaded yet" only threw away a case the library
already handled safely. Fixed by using the real attribute name and calling
`_async_ensure_loaded()` ourselves before reading `async_items()` (see
below for why that specific read needs it too), instead of pre-emptively
giving up.

Deliberately does not delete the resource entry on unload/uninstall - that
would need to distinguish a reload from a real removal (a plain
async_unload_entry fires for both), which isn't worth the complexity for a
harmless leftover entry in the rare case someone fully removes the
integration.

Neither of the above fixes a long-lived tab (a kiosk browser tablet, or a
phone tab left open for days): the resource URL changing server-side only
matters the next time a browser actually asks for it, and a tab that's
already loaded the script never asks again on its own. `KidsCreditsCardView`
covers that case the only way that's actually reliable - the file is
small (a few dozen KB), so serving it with caching disabled outright costs
nothing in practice and removes the staleness class of bug entirely,
instead of just narrowing the window it can happen in.
"""
from __future__ import annotations

import logging
from pathlib import Path

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

RESOURCE_TYPE = "module"


class KidsCreditsCardView(HomeAssistantView):
    """Serves the card JS with Cache-Control: no-store - always a fresh
    fetch, never a stale copy served from a browser's own cache."""

    name = "kids_credits:card_js"
    requires_auth = False

    def __init__(self, url: str, file_path: Path) -> None:
        self.url = url
        self._file_path = file_path

    async def get(self, request: web.Request) -> web.StreamResponse:
        response = web.FileResponse(self._file_path)
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response


class LovelaceResourceRegistration:
    def __init__(self, hass: HomeAssistant, js_path: str) -> None:
        self.hass = hass
        self._js_path = js_path  # e.g. "/kids_credits_static/kids-credits-cards.js", no ?v=

    async def async_try_register(self, version: str) -> bool:
        """Create/update our Lovelace resource entry. Returns False (never
        raises) if the caller should fall back to add_extra_js_url instead."""
        lovelace = self.hass.data.get("lovelace")
        if lovelace is None:
            _LOGGER.debug("Lovelace resource registration: lovelace not set up yet")
            return False
        try:
            if lovelace.resource_mode != "storage":
                _LOGGER.debug(
                    "Lovelace resource registration: dashboard is in %s mode, not storage",
                    lovelace.resource_mode,
                )
                return False
            await self._async_create_or_update(lovelace, version)
            return True
        except Exception as err:  # noqa: BLE001 - any shape mismatch, just fall back
            _LOGGER.debug("Could not register as a Lovelace resource, falling back: %s", err)
            return False

    async def _async_create_or_update(self, lovelace, version: str) -> None:
        resources = lovelace.resources
        # async_create_item/async_update_item below both call this internally before touching
        # storage, so calling it isn't strictly required for *them* - it's needed here so the
        # async_items() read on the next line sees real data instead of an empty pre-load
        # cache. Skipping it meant a startup-timed call could see "no existing resource" (data
        # not loaded yet) and create a duplicate entry instead of finding and updating the real
        # one. `_async_ensure_loaded` is the same idempotent guard HA core's own
        # ResourceStorageCollection.async_get_info() uses for this; getattr guards against a
        # future core version renaming/removing it, in which case we just skip straight to the
        # create/update call below, which still self-loads safely either way.
        ensure_loaded = getattr(resources, "_async_ensure_loaded", None)
        if ensure_loaded is not None:
            await ensure_loaded()

        url = f"{self._js_path}?v={version}"
        existing = [r for r in resources.async_items() if r["url"].split("?")[0] == self._js_path]
        if existing:
            if existing[0]["url"] != url:
                _LOGGER.debug("Updating Lovelace resource: %s -> %s", existing[0]["url"], url)
                await resources.async_update_item(existing[0]["id"], {"res_type": RESOURCE_TYPE, "url": url})
            else:
                _LOGGER.debug("Lovelace resource already current: %s", url)
        else:
            _LOGGER.debug("Creating Lovelace resource: %s", url)
            await resources.async_create_item({"res_type": RESOURCE_TYPE, "url": url})
