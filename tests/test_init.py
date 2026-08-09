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

    assert hass.states.get("sensor.limanah") is not None
    assert hass.states.get("sensor.aline") is not None
    assert hass.states.get("sensor.limanah").state == "0"


async def test_award_points_service_updates_the_sensor(hass: HomeAssistant):
    await _setup_entry(hass)

    await hass.services.async_call(
        DOMAIN,
        "award_points",
        {"kid_id": "limanah", "amount": 3, "reason": "Kamer opgeruimd", "actor": "papa"},
        blocking=True,
    )
    await hass.async_block_till_done()

    state = hass.states.get("sensor.limanah")
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

    assert hass.states.get("sensor.aline").state == "-2"


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

    assert hass.states.get("sensor.limanah").state == "0"


async def test_reward_available_attribute_flips_at_threshold(hass: HomeAssistant):
    await _setup_entry(hass)

    await hass.services.async_call(
        DOMAIN,
        "award_points",
        {"kid_id": "limanah", "amount": 15, "reason": "Opgespaard"},
        blocking=True,
    )
    await hass.async_block_till_done()

    state = hass.states.get("sensor.limanah")
    assert state.attributes["reward_available"] is True
    assert state.attributes["credits_until_reward"] == 0


async def test_options_update_adds_a_new_kid_sensor(hass: HomeAssistant):
    entry = await _setup_entry(hass)

    hass.config_entries.async_update_entry(
        entry, options={CONF_KIDS: ["Limanah", "Aline", "Noor"], CONF_REWARD_THRESHOLD: 15}
    )
    await hass.async_block_till_done()

    assert hass.states.get("sensor.noor") is not None
