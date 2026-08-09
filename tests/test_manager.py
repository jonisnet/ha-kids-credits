"""Manager tests: ledger math, kid sync, validation. Needs a running `hass`
for the real Store helper, but no config entry / entities are set up."""
from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError

from custom_components.kids_credits.manager import KidsCreditsManager


@pytest.fixture(autouse=True)
async def auto_enable_custom_integrations(enable_custom_integrations):
    yield


async def _manager(hass: HomeAssistant, kid_names=None) -> KidsCreditsManager:
    manager = KidsCreditsManager(hass, "test_entry")
    await manager.async_setup(kid_names or ["Limanah", "Aline"])
    return manager


async def test_setup_seeds_kids_from_initial_names(hass: HomeAssistant):
    manager = await _manager(hass)
    assert {k.name for k in manager.kids.values()} == {"Limanah", "Aline"}
    assert manager.balance("limanah") == 0


async def test_setup_does_not_reseed_when_kids_already_stored(hass: HomeAssistant):
    manager = await _manager(hass)
    await manager.async_award("limanah", 3, "Kamer opgeruimd", "papa")

    reloaded = KidsCreditsManager(hass, "test_entry")
    await reloaded.async_setup(["Limanah", "Aline"])
    assert reloaded.balance("limanah") == 3


async def test_award_increases_balance_and_is_logged(hass: HomeAssistant):
    manager = await _manager(hass)
    entry = await manager.async_award("limanah", 3, "Kamer opgeruimd", "papa")

    assert manager.balance("limanah") == 3
    assert entry.category == "task"
    assert manager.history("limanah")[0].reason == "Kamer opgeruimd"


async def test_deduct_decreases_balance_and_can_go_negative(hass: HomeAssistant):
    manager = await _manager(hass)
    await manager.async_deduct("limanah", 5, "Vaat niet opgeruimd", "mama")

    assert manager.balance("limanah") == -5


async def test_award_rejects_non_positive_amount(hass: HomeAssistant):
    manager = await _manager(hass)
    with pytest.raises(ServiceValidationError):
        await manager.async_award("limanah", 0, "reden", None)
    with pytest.raises(ServiceValidationError):
        await manager.async_deduct("limanah", -1, "reden", None)


async def test_award_rejects_unknown_kid(hass: HomeAssistant):
    manager = await _manager(hass)
    with pytest.raises(ServiceValidationError):
        await manager.async_award("nonexistent", 1, "reden", None)


async def test_redeem_succeeds_at_or_above_threshold(hass: HomeAssistant):
    manager = await _manager(hass)
    await manager.async_award("limanah", 15, "Opgespaard", "papa")
    entry = await manager.async_redeem("limanah", 15, "Beloning bij 15 credits", "mama")

    assert entry.category == "reward"
    assert manager.balance("limanah") == 0


async def test_redeem_rejects_insufficient_balance(hass: HomeAssistant):
    manager = await _manager(hass)
    await manager.async_award("limanah", 5, "Klusje", "papa")
    with pytest.raises(ServiceValidationError):
        await manager.async_redeem("limanah", 15, "Beloning", "papa")
    # A rejected redeem must not touch the balance.
    assert manager.balance("limanah") == 5


async def test_history_is_capped_and_most_recent_first(hass: HomeAssistant):
    manager = await _manager(hass)
    for i in range(35):
        await manager.async_award("limanah", 1, f"taak {i}", None)

    history = manager.history("limanah")
    assert len(history) == 30
    assert history[0].reason == "taak 34"


async def test_lifetime_earned_and_deducted_track_independently(hass: HomeAssistant):
    manager = await _manager(hass)
    await manager.async_award("limanah", 4, "a", None)
    await manager.async_deduct("limanah", 1, "b", None)
    await manager.async_award("limanah", 2, "c", None)

    assert manager.lifetime_earned("limanah") == 6
    assert manager.lifetime_deducted("limanah") == 1
    assert manager.balance("limanah") == 5


async def test_sync_kids_keeps_existing_kid_id_and_history_when_name_unchanged(hass: HomeAssistant):
    manager = await _manager(hass)
    await manager.async_award("limanah", 3, "Kamer opgeruimd", "papa")

    await manager.async_sync_kids(["Limanah", "Aline", "Noor"])

    assert set(manager.kids) == {"limanah", "aline", "noor"}
    assert manager.balance("limanah") == 3  # history preserved under the same id


async def test_sync_kids_orphans_but_does_not_delete_history_for_a_removed_kid(hass: HomeAssistant):
    manager = await _manager(hass)
    await manager.async_award("aline", 4, "Klusje", "mama")

    await manager.async_sync_kids(["Limanah"])
    assert "aline" not in manager.kids

    # Re-adding the same name restores access to the same (still-stored) history.
    await manager.async_sync_kids(["Limanah", "Aline"])
    assert manager.balance("aline") == 4


async def test_award_and_deduct_persist_across_reload(hass: HomeAssistant):
    manager = await _manager(hass)
    await manager.async_award("limanah", 3, "a", None)
    await manager.async_deduct("limanah", 1, "b", None)

    reloaded = KidsCreditsManager(hass, "test_entry")
    await reloaded.async_setup(["Limanah", "Aline"])
    assert reloaded.balance("limanah") == 2
    assert len(reloaded.history("limanah")) == 2
