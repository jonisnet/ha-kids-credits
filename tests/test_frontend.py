"""Pure-logic tests for LovelaceResourceRegistration and KidsCreditsCardView -
no running Home Assistant instance required, just a faithful stand-in for the
shape of hass.data["lovelace"] (verified against home-assistant/core's
lovelace/__init__.py: LovelaceData.resource_mode, and lovelace/resources.py:
ResourceStorageCollection._async_ensure_loaded()/async_items()/
async_create_item()/async_update_item())."""
from pathlib import Path

from custom_components.kids_credits.frontend import KidsCreditsCardView, LovelaceResourceRegistration


class FakeResources:
    """Mirrors ResourceStorageCollection's real lazy-load behavior: `loaded` starts False and
    only flips True once `_async_ensure_loaded()` actually runs - the exact mechanism
    async_create_item/async_update_item rely on internally, and which our own
    _async_create_or_update() must also call before reading async_items(), or it sees an
    empty pre-load cache and creates a duplicate instead of finding the real entry."""

    def __init__(self, start_loaded=True):
        self.loaded = start_loaded
        self._items = []
        self._next_id = 1

    async def _async_ensure_loaded(self):
        self.loaded = True

    def async_items(self):
        if not self.loaded:
            return []
        return list(self._items)

    async def async_create_item(self, data):
        await self._async_ensure_loaded()
        item = {**data, "id": str(self._next_id)}
        self._next_id += 1
        self._items.append(item)
        return item

    async def async_update_item(self, item_id, updates):
        await self._async_ensure_loaded()
        for item in self._items:
            if item["id"] == item_id:
                item.update(updates)


class FakeLovelace:
    def __init__(self, resource_mode="storage", start_loaded=True):
        self.resource_mode = resource_mode
        self.resources = FakeResources(start_loaded)


class FakeHass:
    def __init__(self, lovelace=None):
        self.data = {}
        if lovelace is not None:
            self.data["lovelace"] = lovelace


async def test_falls_back_when_lovelace_missing():
    ok = await LovelaceResourceRegistration(FakeHass(), "/x/card.js").async_try_register("1.0.0")
    assert ok is False


async def test_falls_back_in_yaml_mode():
    hass = FakeHass(FakeLovelace(resource_mode="yaml"))
    ok = await LovelaceResourceRegistration(hass, "/x/card.js").async_try_register("1.0.0")
    assert ok is False


async def test_creates_a_new_resource_entry():
    lovelace = FakeLovelace()
    hass = FakeHass(lovelace)
    ok = await LovelaceResourceRegistration(hass, "/x/card.js").async_try_register("1.0.0")

    assert ok is True
    items = lovelace.resources.async_items()
    assert len(items) == 1
    assert items[0]["url"] == "/x/card.js?v=1.0.0"
    assert items[0]["res_type"] == "module"


async def test_succeeds_and_loads_when_resources_not_yet_loaded():
    """The real bug this project shipped for a while: bailing out to the flakier
    add_extra_js_url fallback just because `.loaded` was still False at this exact moment,
    instead of doing what ResourceStorageCollection's own methods already do safely -
    ensure-load, then proceed. Not loaded yet must not mean "give up"."""
    lovelace = FakeLovelace(start_loaded=False)
    hass = FakeHass(lovelace)
    ok = await LovelaceResourceRegistration(hass, "/x/card.js").async_try_register("1.0.0")

    assert ok is True
    assert lovelace.resources.loaded is True
    items = lovelace.resources.async_items()
    assert len(items) == 1
    assert items[0]["url"] == "/x/card.js?v=1.0.0"


async def test_reregistering_same_version_does_not_duplicate():
    lovelace = FakeLovelace()
    hass = FakeHass(lovelace)
    registration = LovelaceResourceRegistration(hass, "/x/card.js")
    await registration.async_try_register("1.0.0")

    await registration.async_try_register("1.0.0")

    assert len(lovelace.resources.async_items()) == 1


async def test_version_bump_updates_the_existing_entry_in_place():
    lovelace = FakeLovelace()
    hass = FakeHass(lovelace)
    registration = LovelaceResourceRegistration(hass, "/x/card.js")
    await registration.async_try_register("1.0.0")

    await registration.async_try_register("1.0.1")

    items = lovelace.resources.async_items()
    assert len(items) == 1
    assert items[0]["url"] == "/x/card.js?v=1.0.1"


async def test_starting_unloaded_then_reregistering_still_does_not_duplicate():
    """Guards specifically against the "read async_items() before the collection has
    loaded" duplicate-creation trap: the first call starts unloaded (forcing an
    ensure-load through async_create_item), the second call starts from an
    already-loaded collection - both must resolve to the same one entry."""
    lovelace = FakeLovelace(start_loaded=False)
    hass = FakeHass(lovelace)
    registration = LovelaceResourceRegistration(hass, "/x/card.js")
    await registration.async_try_register("1.0.0")

    await registration.async_try_register("1.0.1")

    items = lovelace.resources.async_items()
    assert len(items) == 1
    assert items[0]["url"] == "/x/card.js?v=1.0.1"


async def test_unexpected_internal_shape_change_falls_back_instead_of_raising():
    class BrokenResources:
        loaded = True

        @staticmethod
        def async_items():
            raise AttributeError("shape changed in a future HA version")

    class BrokenLovelace:
        resource_mode = "storage"
        resources = BrokenResources()

    hass = FakeHass(BrokenLovelace())
    ok = await LovelaceResourceRegistration(hass, "/x/card.js").async_try_register("1.0.0")

    assert ok is False


async def test_card_view_disables_caching():
    view = KidsCreditsCardView("/x/card.js", Path(__file__))  # any real file path
    response = await view.get(None)

    cache_control = response.headers["Cache-Control"]
    assert "no-store" in cache_control
    assert "no-cache" in cache_control
    assert response.headers["Pragma"] == "no-cache"
    assert response.headers["Expires"] == "0"
