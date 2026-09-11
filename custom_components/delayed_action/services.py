"""Delayed Action services.

Services:
  - delayed_action.run_later : Create and start a new timer
  - delayed_action.cancel    : Cancel a timer
"""
from __future__ import annotations

import logging
import re
import uuid

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er

from .const import (
    ACTION_CUSTOM,
    ACTION_TURN_OFF,
    ACTION_TURN_ON,
    ATTR_ACTION,
    ATTR_DELAY,
    ATTR_ENTITY_ID,
    ATTR_NAME,
    ATTR_SERVICE,
    ATTR_SERVICE_DATA,
    ATTR_TIMER_ID,
    DATA_ENTITY_COMPONENT,
    DATA_TIMERS,
    DOMAIN,
    SERVICE_CANCEL,
    SERVICE_RUN_LATER,
    parse_delay,
)
from .timer import DelayedActionSwitchEntity

_LOGGER = logging.getLogger(__name__)


# --- Schemas ---
SERVICE_NAME_RE = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")

RUN_LATER_SCHEMA = vol.Schema(
    {
        vol.Exclusive(ATTR_ENTITY_ID, "target"): cv.entity_id,
        vol.Exclusive(ATTR_SERVICE, "target"): vol.All(
            cv.string,
            vol.Match(SERVICE_NAME_RE),
        ),
        vol.Optional(ATTR_SERVICE_DATA): dict,
        vol.Optional(ATTR_ACTION): vol.In(
            [ACTION_TURN_ON, ACTION_TURN_OFF, ACTION_CUSTOM]
        ),
        vol.Required(ATTR_DELAY): vol.Any(
            vol.Coerce(float),
            cv.string,
            dict,
        ),
        vol.Optional(ATTR_NAME): cv.string,
    },
    extra=vol.ALLOW_EXTRA,
)

CANCEL_SCHEMA = vol.Schema(
    {
        vol.Exclusive(ATTR_TIMER_ID, "cancel_target"): cv.string,
        vol.Exclusive(ATTR_ENTITY_ID, "cancel_target"): cv.entity_id,
    }
)


def _build_target(call: ServiceCall) -> tuple[str, dict, str | None]:
    """Build target service, service_data and target_entity from a service call.

    One of two modes is used:
      1) entity_id + action -> domain.{turn_on|turn_off} is derived automatically
      2) service (+ service_data) -> used directly

    Returns:
        (target_service, target_service_data, target_entity_id)
    """
    entity_id = call.data.get(ATTR_ENTITY_ID)
    action = call.data.get(ATTR_ACTION, ACTION_CUSTOM)
    service = call.data.get(ATTR_SERVICE)
    service_data = dict(call.data.get(ATTR_SERVICE_DATA) or {})

    if entity_id is not None:
        # entity_id + action mode
        domain = entity_id.split(".")[0]
        if action == ACTION_CUSTOM and service is not None:
            target_service = service
        elif action in (ACTION_TURN_ON, ACTION_TURN_OFF):
            target_service = f"{domain}.{action}"
        else:
            # When no action is given, a service is required
            if service is None:
                raise vol.Invalid(
                    "when entity_id is given, either action (turn_on/turn_off) "
                    "or service must be specified"
                )
            target_service = service
        # Add entity_id to service_data (if missing)
        service_data.setdefault("entity_id", entity_id)
        return target_service, service_data, entity_id

    # service mode
    if service is None:
        raise vol.Invalid("entity_id or service must be specified")
    target_service = service
    return target_service, service_data, None


async def async_setup_services(hass: HomeAssistant) -> None:
    """Register services. Idempotent: overwrites if called again."""
    if hass.services.has_service(DOMAIN, SERVICE_RUN_LATER):
        return

    async def handle_run_later(call: ServiceCall) -> ServiceResponse:
        """run_later service: create and start a new timer."""
        target_service, target_service_data, target_entity = _build_target(call)
        delay = parse_delay(call.data[ATTR_DELAY])
        name = call.data.get(ATTR_NAME, "Delayed Action")

        # Check whether the target service exists
        service_domain = target_service.split(".")[0]
        if not hass.services.has_service(service_domain, target_service.split(".")[1]):
            _LOGGER.warning(
                "Target service is not available: %s (timer was still created)",
                target_service,
            )

        timer_id = uuid.uuid4().hex[:12]
        entity = DelayedActionSwitchEntity(
            hass,
            timer_id=timer_id,
            name=name,
            target_service=target_service,
            target_service_data=target_service_data,
            delay=delay,
            target_entity=target_entity,
            persistent=False,
        )

        # Add the entity via EntityComponent
        component = hass.data[DOMAIN].get(DATA_ENTITY_COMPONENT)
        if component is None:
            _LOGGER.error("Entity component is not ready")
            return {"error": "component_not_ready"}

        await component.async_add_entities([entity])
        # Start the timer
        await entity.async_turn_on()

        # Register
        hass.data[DOMAIN][DATA_TIMERS][timer_id] = entity
        entity_id = entity.entity_id

        _LOGGER.info(
            "New delayed action timer: id=%s entity=%s service=%s delay=%ss",
            timer_id,
            entity_id,
            target_service,
            int(delay.total_seconds()),
        )

        return {
            ATTR_TIMER_ID: timer_id,
            ATTR_ENTITY_ID: entity_id,
            ATTR_SERVICE: target_service,
            "delay_seconds": int(delay.total_seconds()),
        }

    async def _remove_entity_fully(entity: DelayedActionSwitchEntity) -> None:
        """Remove an entity completely from platform + state + registry."""
        eid = entity.entity_id
        component = hass.data[DOMAIN].get(DATA_ENTITY_COMPONENT)
        if component is not None and eid:
            await component.async_remove_entity(eid)
        elif eid:
            await entity.async_remove(force_remove=True)
        if eid:
            registry = er.async_get(hass)
            if registry.async_get(eid) is not None:
                registry.async_remove(eid)

    async def handle_cancel(call: ServiceCall) -> ServiceResponse:
        """cancel service: permanently cancel/remove a timer."""
        timer_id = call.data.get(ATTR_TIMER_ID)
        entity_id = call.data.get(ATTR_ENTITY_ID)

        timers = hass.data[DOMAIN][DATA_TIMERS]
        entity: DelayedActionSwitchEntity | None = None

        if timer_id is not None:
            entity = timers.get(timer_id)
        elif entity_id is not None:
            # Search active timers by entity_id
            for tid, ent in timers.items():
                if ent.entity_id == entity_id:
                    entity = ent
                    timer_id = tid
                    break

        if entity is not None:
            eid = entity.entity_id
            if entity.is_persistent:
                # Persistent timer: remove the config entry so it does not
                # come back after a restart.
                # async_remove -> async_unload_entry -> entity removed from platform.
                entry = hass.config_entries.async_get_entry(timer_id)
                if entry is not None:
                    await hass.config_entries.async_remove(entry.entry_id)
                else:
                    await entity.async_turn_off()
                    timers.pop(timer_id, None)
                    await _remove_entity_fully(entity)
            else:
                await entity.async_turn_off()
                timers.pop(timer_id, None)
                await _remove_entity_fully(entity)

            # Clean up the registry so no ghost entity remains
            if eid:
                registry = er.async_get(hass)
                if registry.async_get(eid) is not None:
                    registry.async_remove(eid)

            _LOGGER.info("Delayed action timer removed: %s", eid)
            return {"cancelled": True, ATTR_TIMER_ID: timer_id, ATTR_ENTITY_ID: eid}

        # Not among active timers: clean up a stale entity left in registry/state
        if entity_id is not None:
            removed = False
            component = hass.data[DOMAIN].get(DATA_ENTITY_COMPONENT)
            if component is not None and component.get_entity(entity_id) is not None:
                await component.async_remove_entity(entity_id)
                removed = True
            registry = er.async_get(hass)
            if registry.async_get(entity_id) is not None:
                registry.async_remove(entity_id)
                removed = True
            if hass.states.get(entity_id) is not None:
                hass.states.async_remove(entity_id)
                removed = True
            if removed:
                _LOGGER.info("Stale delayed_action entity removed: %s", entity_id)
                return {"cancelled": True, ATTR_ENTITY_ID: entity_id}

        _LOGGER.warning(
            "Timer to cancel was not found: timer_id=%s entity_id=%s",
            timer_id,
            entity_id,
        )
        return {"cancelled": False, "error": "not_found"}

    hass.services.async_register(
        DOMAIN, SERVICE_RUN_LATER, handle_run_later, schema=RUN_LATER_SCHEMA,
        supports_response=True,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_CANCEL, handle_cancel, schema=CANCEL_SCHEMA,
        supports_response=True,
    )
    _LOGGER.info("Delayed Action services registered: %s, %s", SERVICE_RUN_LATER, SERVICE_CANCEL)


async def async_unload_services(hass: HomeAssistant) -> None:
    """Unregister services."""
    for service in (SERVICE_RUN_LATER, SERVICE_CANCEL):
        if hass.services.has_service(DOMAIN, service):
            hass.services.async_remove(DOMAIN, service)
