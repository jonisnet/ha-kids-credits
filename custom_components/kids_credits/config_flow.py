"""Config flow for Kids Credits. Single instance; kids are managed via options."""
from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult

from .const import (
    CONF_KIDS,
    CONF_REWARD_THRESHOLD,
    DEFAULT_KID_NAMES,
    DEFAULT_REWARD_THRESHOLD,
    DOMAIN,
)


def _names_to_string(names: list[str]) -> str:
    return ", ".join(names)


def _string_to_names(value: str) -> list[str]:
    return [n.strip() for n in value.split(",") if n.strip()]


class KidsCreditsConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict | None = None) -> FlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is not None:
            kids = _string_to_names(user_input[CONF_KIDS])
            return self.async_create_entry(
                title="Kids Credits",
                data={},
                options={
                    CONF_KIDS: kids,
                    CONF_REWARD_THRESHOLD: user_input[CONF_REWARD_THRESHOLD],
                },
            )

        schema = vol.Schema(
            {
                vol.Required(CONF_KIDS, default=_names_to_string(DEFAULT_KID_NAMES)): str,
                vol.Required(CONF_REWARD_THRESHOLD, default=DEFAULT_REWARD_THRESHOLD): vol.Coerce(int),
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry) -> "KidsCreditsOptionsFlow":
        return KidsCreditsOptionsFlow(config_entry)


class KidsCreditsOptionsFlow(config_entries.OptionsFlow):
    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        self._config_entry = config_entry

    async def async_step_init(self, user_input: dict | None = None) -> FlowResult:
        if user_input is not None:
            kids = _string_to_names(user_input[CONF_KIDS])
            return self.async_create_entry(
                title="",
                data={
                    CONF_KIDS: kids,
                    CONF_REWARD_THRESHOLD: user_input[CONF_REWARD_THRESHOLD],
                },
            )

        current_kids = self._config_entry.options.get(CONF_KIDS, DEFAULT_KID_NAMES)
        current_threshold = self._config_entry.options.get(CONF_REWARD_THRESHOLD, DEFAULT_REWARD_THRESHOLD)
        schema = vol.Schema(
            {
                vol.Required(CONF_KIDS, default=_names_to_string(current_kids)): str,
                vol.Required(CONF_REWARD_THRESHOLD, default=current_threshold): vol.Coerce(int),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
