"""Integration-level tests: config entry setup, services, sensor entities."""
from __future__ import annotations

from unittest.mock import patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.kids_credits.const import CONF_KIDS, CONF_REWARD_THRESHOLD, DOMAIN
from homeassistant.core import HomeAssistant


@pytest.fixture(autouse=True)
async def auto_enable_custom_integrations(enable_custom_integrations):
    yield


async def _setup_entry(hass: HomeAssistant, options: dict | None = None) -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Kids Credits",
        data={},
        options=options or {CONF_KIDS: ["Limanah", "Aline"], CONF_REWARD_THRESHOLD: 15},
    )
    entry.add_to_hass(hass)
    with patch(f"custom_components.{DOMAIN}._async_register_frontend", return_value=None):
        assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_setup_creates_one_sensor_per_kid(hass: HomeAssistant):
    await _setup_entry(hass)

    assert hass.states.get("kids_credits.limanah") is not None
    assert hass.states.get("kids_credits.aline") is not None
    assert hass.states.get("kids_credits.limanah").state == "0"


async def test_award_points_service_updates_the_sensor(hass: HomeAssistant):
    await _setup_entry(hass)

    await hass.services.async_call(
        DOMAIN,
        "award_points",
        {"kid_id": "limanah", "amount": 3, "reason": "Kamer opgeruimd", "actor": "papa"},
        blocking=True,
    )
    await hass.async_block_till_done()

    state = hass.states.get("kids_credits.limanah")
    assert state.state == "3"
    assert state.attributes["lifetime_earned"] == 3
    assert state.attributes["history"][0]["reason"] == "Kamer opgeruimd"


async def test_deduct_points_service_updates_the_sensor(hass: HomeAssistant):
    await _setup_entry(hass)

    await hass.services.async_call(
        DOMAIN,
        "deduct_points",
        {"kid_id": "aline", "amount": 2, "reason": "Schoenen niet opgeruimd"},
        blocking=True,
    )
    await hass.async_block_till_done()

    assert hass.states.get("kids_credits.aline").state == "-2"


async def test_redeem_reward_service_rejects_insufficient_balance(hass: HomeAssistant):
    await _setup_entry(hass)

    with pytest.raises(Exception):
        await hass.services.async_call(
            DOMAIN,
            "redeem_reward",
            {"kid_id": "limanah", "amount": 15, "reason": "Beloning"},
            blocking=True,
        )
    await hass.async_block_till_done()

    assert hass.states.get("kids_credits.limanah").state == "0"


async def test_reward_available_attribute_flips_at_threshold(hass: HomeAssistant):
    await _setup_entry(hass)

    await hass.services.async_call(
        DOMAIN,
        "award_points",
        {"kid_id": "limanah", "amount": 15, "reason": "Opgespaard"},
        blocking=True,
    )
    await hass.async_block_till_done()

    state = hass.states.get("kids_credits.limanah")
    assert state.attributes["reward_available"] is True
    assert state.attributes["credits_until_reward"] == 0


async def test_set_kid_photo_service_updates_the_sensor_attribute(hass: HomeAssistant):
    await _setup_entry(hass)

    await hass.services.async_call(
        DOMAIN,
        "set_kid_photo",
        {"kid_id": "limanah", "photo": "data:image/png;base64,abcd"},
        blocking=True,
    )
    await hass.async_block_till_done()

    assert hass.states.get("kids_credits.limanah").attributes["photo"] == "data:image/png;base64,abcd"


async def test_request_credit_service_shows_up_as_pending_on_the_sensor(hass: HomeAssistant):
    await _setup_entry(hass)

    await hass.services.async_call(
        DOMAIN,
        "request_credit",
        {"kid_id": "limanah", "reason": "Kamer opgeruimd"},
        blocking=True,
    )
    await hass.async_block_till_done()

    requests = hass.states.get("kids_credits.limanah").attributes["requests"]
    assert len(requests) == 1
    assert requests[0]["status"] == "pending"
    assert hass.states.get("kids_credits.limanah").state == "0"  # balance unchanged


async def test_approve_request_service_awards_credits(hass: HomeAssistant):
    await _setup_entry(hass)
    await hass.services.async_call(
        DOMAIN, "request_credit", {"kid_id": "limanah", "reason": "Kamer opgeruimd"}, blocking=True
    )
    await hass.async_block_till_done()
    request_id = hass.states.get("kids_credits.limanah").attributes["requests"][0]["id"]

    await hass.services.async_call(
        DOMAIN,
        "approve_request",
        {"request_id": request_id, "amount": 3, "actor": "papa"},
        blocking=True,
    )
    await hass.async_block_till_done()

    state = hass.states.get("kids_credits.limanah")
    assert state.state == "3"
    assert state.attributes["requests"][0]["status"] == "approved"
    assert state.attributes["history"][0]["reason"] == "Kamer opgeruimd"


async def test_reject_request_service_leaves_balance_unchanged(hass: HomeAssistant):
    await _setup_entry(hass)
    await hass.services.async_call(
        DOMAIN, "request_credit", {"kid_id": "aline", "reason": "Vaatwasser uitgeruimd"}, blocking=True
    )
    await hass.async_block_till_done()
    request_id = hass.states.get("kids_credits.aline").attributes["requests"][0]["id"]

    await hass.services.async_call(
        DOMAIN, "reject_request", {"request_id": request_id, "actor": "mama"}, blocking=True
    )
    await hass.async_block_till_done()

    state = hass.states.get("kids_credits.aline")
    assert state.state == "0"
    assert state.attributes["requests"][0]["status"] == "rejected"


async def test_request_reward_service_approval_deducts_credits(hass: HomeAssistant):
    await _setup_entry(hass)
    await hass.services.async_call(
        DOMAIN, "award_points", {"kid_id": "limanah", "amount": 15, "reason": "opgespaard"}, blocking=True
    )
    await hass.services.async_call(
        DOMAIN, "request_reward", {"kid_id": "limanah", "reason": "Robux", "amount": 15}, blocking=True
    )
    await hass.async_block_till_done()
    request = hass.states.get("kids_credits.limanah").attributes["requests"][0]
    assert request["kind"] == "reward"

    await hass.services.async_call(
        DOMAIN,
        "approve_request",
        {"request_id": request["id"], "amount": 15, "actor": "papa"},
        blocking=True,
    )
    await hass.async_block_till_done()

    assert hass.states.get("kids_credits.limanah").state == "0"


async def test_clear_history_service_resets_balance(hass: HomeAssistant):
    await _setup_entry(hass)
    await hass.services.async_call(
        DOMAIN, "award_points", {"kid_id": "limanah", "amount": 5, "reason": "klusje"}, blocking=True
    )
    await hass.async_block_till_done()
    assert hass.states.get("kids_credits.limanah").state == "5"

    await hass.services.async_call(DOMAIN, "clear_history", {"kid_id": "limanah"}, blocking=True)
    await hass.async_block_till_done()

    state = hass.states.get("kids_credits.limanah")
    assert state.state == "0"
    assert state.attributes["history"] == []


async def test_options_update_adds_a_new_kid_sensor(hass: HomeAssistant):
    entry = await _setup_entry(hass)

    hass.config_entries.async_update_entry(
        entry, options={CONF_KIDS: ["Limanah", "Aline", "Noor"], CONF_REWARD_THRESHOLD: 15}
    )
    await hass.async_block_till_done()

    assert hass.states.get("kids_credits.noor") is not None
