"""Delayed Action integration."""
from __future__ import annotations

import json
import logging
import os
import shutil
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_component import EntityComponent

from .const import (
    ACTION_CUSTOM,
    ACTION_TURN_OFF,
    ACTION_TURN_ON,
    CONF_ACTION,
    CONF_DELAY_SECONDS,
    CONF_SERVICE,
    CONF_SERVICE_DATA,
    CONF_TARGET_ENTITY,
    DATA_ENTITY_COMPONENT,
    DATA_TIMERS,
    DEFAULT_DELAY_SECONDS,
    DEFAULT_NAME,
    DOMAIN,
)
from .services import async_setup_services
from .timer import DelayedActionSwitchEntity

_LOGGER = logging.getLogger(__name__)

PANEL_TITLE = "Delayed Action"
PANEL_ICON = "mdi:timer-settings-outline"
WWW_FILES = [
    "delayed-action-panel.js",
    "delayed-action-card.js",
    "delayed-action-card-editor.js",
]


def _get_version() -> str:
    """Read the version from manifest.json (used for cache busting)."""
    manifest_path = os.path.join(os.path.dirname(__file__), "manifest.json")
    try:
        with open(manifest_path, encoding="utf-8") as f:
            return json.load(f).get("version", "1")
    except Exception:
        return "1"


def _ensure_www_files(hass: HomeAssistant) -> None:
    """Copy the panel and card JS files into config/www."""
    try:
        source_dir = os.path.join(os.path.dirname(__file__), "www")
        target_dir = hass.config.path("www")
        os.makedirs(target_dir, exist_ok=True)
        for fname in WWW_FILES:
            src = os.path.join(source_dir, fname)
            dst = os.path.join(target_dir, fname)
            if os.path.isfile(src):
                shutil.copy2(src, dst)
                _LOGGER.debug("WWW file copied: %s", dst)
    except Exception as ex:
        _LOGGER.warning("Delayed Action www files could not be copied: %s", ex)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Component setup."""
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][DATA_TIMERS] = {}

    # Copy panel/card JS files into config/www
    await hass.async_add_executor_job(_ensure_www_files, hass)

    # Manage entities under our own domain via EntityComponent
    component = EntityComponent(_LOGGER, DOMAIN, hass)
    hass.data[DOMAIN][DATA_ENTITY_COMPONENT] = component
    await component.async_setup({})

    # Register services
    await async_setup_services(hass)

    # Register the sidebar panel
    await _async_register_panel(hass)

    _LOGGER.info("Delayed Action component loaded")
    return True


async def _async_register_panel(hass: HomeAssistant) -> None:
    """Register the sidebar panel via Python code."""
    try:
        from homeassistant.components.panel_custom import async_register_panel

        version = _get_version()
        module_url = f"/local/delayed-action-panel.js?v={version}"

        await async_register_panel(
            hass,
            webcomponent_name="delayed-action-panel",
            frontend_url_path="delayed-action",
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            module_url=module_url,
            embed_iframe=False,
            require_admin=False,
        )
        _LOGGER.info("Delayed Action panel added to sidebar: %s", module_url)
    except Exception as ex:
        _LOGGER.warning("Panel registration failed: %s", ex)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Create a persistent timer from a config entry."""
    data = {**entry.data, **(entry.options or {})}
    name = data.get("name", DEFAULT_NAME)
    target_entity = data.get(CONF_TARGET_ENTITY)
    action = data.get(CONF_ACTION, ACTION_CUSTOM)
    service = data.get(CONF_SERVICE)
    service_data = dict(data.get(CONF_SERVICE_DATA) or {})
    delay_seconds = data.get(CONF_DELAY_SECONDS, DEFAULT_DELAY_SECONDS)

    if target_entity:
        domain = target_entity.split(".")[0]
        if action in (ACTION_TURN_ON, ACTION_TURN_OFF):
            target_service = f"{domain}.{action}"
        elif action == ACTION_CUSTOM and service:
            target_service = service
        else:
            target_service = service or f"{domain}.{ACTION_TURN_OFF}"
        service_data.setdefault("entity_id", target_entity)
    else:
        if not service:
            return False
        target_service = service

    delay = timedelta(seconds=int(delay_seconds))
    entity = DelayedActionSwitchEntity(
        hass,
        timer_id=entry.entry_id,
        name=name,
        target_service=target_service,
        target_service_data=service_data,
        delay=delay,
        target_entity=target_entity,
        persistent=True,
    )

    component: EntityComponent = hass.data[DOMAIN][DATA_ENTITY_COMPONENT]
    await component.async_add_entities([entity])
    hass.data[DOMAIN][DATA_TIMERS][entry.entry_id] = entity
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    timers = hass.data[DOMAIN].get(DATA_TIMERS, {})
    entity = timers.pop(entry.entry_id, None)
    if entity is not None:
        await entity.async_turn_off()
        if entity.entity_id:
            component = hass.data[DOMAIN].get(DATA_ENTITY_COMPONENT)
            if component is not None:
                await component.async_remove_entity(entity.entity_id)
    return True
