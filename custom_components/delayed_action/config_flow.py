"""Delayed Action config flow.

Adds persistent timers via Integrations -> Add -> Delayed Action.
"""
from __future__ import annotations

from typing import Optional

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
    ACTION_CUSTOM,
    ACTION_TURN_OFF,
    ACTION_TURN_ON,
    ACTIONS,
    CONF_ACTION,
    CONF_DELAY_SECONDS,
    CONF_SERVICE,
    CONF_SERVICE_DATA,
    CONF_TARGET_ENTITY,
    DEFAULT_DELAY_SECONDS,
    DEFAULT_NAME,
    DOMAIN,
)


def _build_schema(defaults: Optional[dict] = None) -> vol.Schema:
    """Shared schema for the config and options flows."""
    defaults = defaults or {}
    return vol.Schema(
        {
            vol.Required(
                "name",
                default=defaults.get("name", DEFAULT_NAME),
            ): selector.TextSelector(
                selector.TextSelectorConfig(type="text")
            ),
            vol.Required(
                CONF_TARGET_ENTITY,
                default=defaults.get(CONF_TARGET_ENTITY, ""),
            ): selector.EntitySelector(),
            vol.Required(
                CONF_ACTION,
                default=defaults.get(CONF_ACTION, ACTION_TURN_OFF),
            ): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=ACTIONS,
                    mode="dropdown",
                    translation_key=CONF_ACTION,
                )
            ),
            vol.Optional(
                CONF_SERVICE,
                default=defaults.get(CONF_SERVICE, ""),
            ): selector.TextSelector(
                selector.TextSelectorConfig(
                    type="text",
                    placeholder="climate.set_temperature",
                )
            ),
            vol.Optional(
                CONF_SERVICE_DATA,
                default=defaults.get(CONF_SERVICE_DATA, {}),
            ): selector.ObjectSelector(),
            vol.Required(
                CONF_DELAY_SECONDS,
                default=defaults.get(CONF_DELAY_SECONDS, DEFAULT_DELAY_SECONDS),
            ): selector.NumberSelector(
                selector.NumberSelectorConfig(
                    min=1,
                    max=86400,
                    step=1,
                    mode="box",
                    unit_of_measurement="s",
                )
            ),
        }
    )


class DelayedActionConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Delayed Action config flow."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """First step: timer parameters."""
        errors = {}

        if user_input is not None:
            # Validation
            action = user_input.get(CONF_ACTION, ACTION_CUSTOM)
            target_entity = user_input.get(CONF_TARGET_ENTITY)
            service = user_input.get(CONF_SERVICE)

            if action == ACTION_CUSTOM and not service and not target_entity:
                errors[CONF_SERVICE] = "service_or_entity_required"
            elif not target_entity and not service:
                errors[CONF_TARGET_ENTITY] = "service_or_entity_required"

            if not errors:
                # Check whether an entry with the same name already exists
                name = user_input.get("name", DEFAULT_NAME)
                await self.async_set_unique_id(f"delayed_action_{name}")
                self._abort_if_unique_id_configured()

                return self.async_create_entry(
                    title=name,
                    data=user_input,
                )

        data_schema = _build_schema()

        return self.async_show_form(
            step_id="user",
            data_schema=data_schema,
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        """Options flow — edit config entry settings."""
        return DelayedActionOptionsFlow(config_entry)


class DelayedActionOptionsFlow(config_entries.OptionsFlow):
    """Delayed Action options flow."""

    def __init__(self, config_entry):
        """Initialize the options flow."""
        self.config_entry = config_entry

    async def async_step_init(self, user_input=None):
        """Options step."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        data = self.config_entry.data
        data_schema = _build_schema(data)

        return self.async_show_form(step_id="init", data_schema=data_schema)
