"""Delayed Action toggle entity.

Each timer is represented as a toggle entity:
  - turn_on  -> start the timer
  - turn_off -> cancel the timer
  - is_on    -> whether the timer is running
  - extra_state_attributes -> remaining time, status, target info
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from homeassistant.const import STATE_ON, STATE_OFF
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import (
    async_call_later,
    async_track_time_interval,
)
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.entity import ToggleEntity

from .const import (
    ATTR_DURATION,
    ATTR_FINISH_TIME,
    ATTR_REMAINING,
    ATTR_STATUS,
    ATTR_TARGET_ENTITY,
    ATTR_TARGET_SERVICE,
    ATTR_TARGET_SERVICE_DATA,
    STATUS_CANCELLED,
    STATUS_FINISHED,
    STATUS_IDLE,
    STATUS_RUNNING,
)

_LOGGER = logging.getLogger(__name__)

# Interval for remaining-time updates
_REMAINING_UPDATE_INTERVAL = timedelta(seconds=1)


class DelayedActionSwitchEntity(ToggleEntity, RestoreEntity):
    """Delayed action timer.

    Calls a target service/service_data after a given delay.
    """

    def __init__(
        self,
        hass: HomeAssistant,
        timer_id: str,
        name: str,
        target_service: str,
        target_service_data: dict,
        delay: timedelta,
        target_entity: str | None = None,
        persistent: bool = False,
    ):
        """Initialize the timer entity.

        Args:
            hass: Home Assistant instance
            timer_id: Unique timer identifier
            name: Entity display name
            target_service: Service to call (e.g. "light.turn_off")
            target_service_data: Data passed to the service (incl. entity_id)
            delay: Delay duration
            target_entity: Target entity_id (for display only)
            persistent: Whether it was created from a config entry
        """
        super().__init__()
        self.hass = hass
        self._timer_id = timer_id
        self._attr_name = name
        self._attr_unique_id = timer_id
        self._target_service = target_service
        self._target_service_data = target_service_data or {}
        self._target_entity = target_entity
        self._delay = delay
        self._persistent = persistent

        # Runtime state
        self._attr_should_poll = False
        self._is_on = False
        self._status = STATUS_IDLE
        self._finish_time: datetime | None = None
        self._remaining: timedelta = timedelta(0)

        # Internal task/listener references
        self._cancel_timer_job = None
        self._cancel_interval = None

    # --- Entity identity ---
    @property
    def timer_id(self) -> str:
        """Return the timer identifier."""
        return self._timer_id

    @property
    def is_persistent(self) -> bool:
        """Whether it was created from a config entry."""
        return self._persistent

    @property
    def is_on(self) -> bool:
        """Whether the timer is running."""
        return self._is_on

    @property
    def state(self) -> str:
        """Return the entity state."""
        return STATE_ON if self._is_on else STATE_OFF

    @property
    def extra_state_attributes(self) -> dict:
        """Return timer information."""
        attrs = {
            ATTR_STATUS: self._status,
            ATTR_REMAINING: int(self._remaining.total_seconds()),
            ATTR_DURATION: int(self._delay.total_seconds()),
            ATTR_TARGET_SERVICE: self._target_service,
            ATTR_TARGET_SERVICE_DATA: self._target_service_data,
        }
        if self._target_entity:
            attrs[ATTR_TARGET_ENTITY] = self._target_entity
        if self._finish_time:
            attrs[ATTR_FINISH_TIME] = self._finish_time.isoformat()
        return attrs

    # --- Toggle behavior ---
    async def async_turn_on(self, **kwargs):
        """Start the timer."""
        await self._start_timer()

    async def async_turn_off(self, **kwargs):
        """Cancel the timer."""
        await self._cancel_timer()

    # --- Internal timer logic ---
    async def _start_timer(self):
        """Set up and start the timer."""
        # Clean up any previous task/listener
        self._cleanup_listeners()

        now = datetime.now(timezone.utc)
        self._finish_time = now + self._delay
        self._remaining = self._delay
        self._is_on = True
        self._status = STATUS_RUNNING

        # Callback invoked when time runs out
        self._cancel_timer_job = async_call_later(
            self.hass, self._delay, self._timer_finished
        )

        # Update the remaining time every second
        self._cancel_interval = async_track_time_interval(
            self.hass, self._update_remaining, _REMAINING_UPDATE_INTERVAL
        )

        self.async_write_ha_state()
        _LOGGER.info(
            "Delayed action '%s' started: %s -> %s, finishes at: %s",
            self._attr_name,
            self._target_service,
            self._target_service_data,
            self._finish_time.isoformat(),
        )

    @callback
    def _update_remaining(self, now: datetime):
        """Update the remaining time (every second)."""
        if self._finish_time is None:
            return
        self._remaining = self._finish_time - now
        if self._remaining.total_seconds() < 0:
            self._remaining = timedelta(0)
        self.async_write_ha_state()

    async def _timer_finished(self, _now):
        """Call the target service when time runs out."""
        _LOGGER.info(
            "Delayed action '%s' finished, calling service: %s",
            self._attr_name,
            self._target_service,
        )
        try:
            await self.hass.services.async_call(
                self._target_service.split(".")[0],
                self._target_service.split(".")[1],
                self._target_service_data,
                blocking=True,
            )
        except Exception as ex:  # noqa: BLE001
            _LOGGER.error(
                "Delayed action '%s' target service call failed: %s",
                self._attr_name,
                ex,
            )

        self._is_on = False
        self._status = STATUS_FINISHED
        self._remaining = timedelta(0)
        self._finish_time = None
        self._cleanup_listeners()
        self.async_write_ha_state()

    async def _cancel_timer(self):
        """Cancel the timer (without calling the target service)."""
        self._cleanup_listeners()
        self._is_on = False
        self._status = STATUS_CANCELLED
        self._remaining = timedelta(0)
        self._finish_time = None
        self.async_write_ha_state()
        _LOGGER.info("Delayed action '%s' cancelled", self._attr_name)

    def _cleanup_listeners(self):
        """Clean up tasks and listeners."""
        if self._cancel_timer_job is not None:
            self._cancel_timer_job()
            self._cancel_timer_job = None
        if self._cancel_interval is not None:
            self._cancel_interval()
            self._cancel_interval = None

    # --- Restore ---
    async def async_added_to_hass(self):
        """Restore the previous state when HA starts."""
        await super().async_added_to_hass()

        # Restore previous state
        old_state = await self.async_get_last_state()
        if old_state is None:
            return

        # Restore status and target info
        old_attrs = old_state.attributes
        self._status = old_attrs.get(ATTR_STATUS, STATUS_IDLE)
        self._target_service = old_attrs.get(
            ATTR_TARGET_SERVICE, self._target_service
        )
        self._target_service_data = old_attrs.get(
            ATTR_TARGET_SERVICE_DATA, self._target_service_data
        )
        self._target_entity = old_attrs.get(
            ATTR_TARGET_ENTITY, self._target_entity
        )
        duration = old_attrs.get(ATTR_DURATION)
        if duration is not None:
            self._delay = timedelta(seconds=int(duration))

        finish_time_str = old_attrs.get(ATTR_FINISH_TIME)
        if self._status == STATUS_RUNNING and finish_time_str:
            # Parse finish_time
            try:
                finish_time = datetime.fromisoformat(finish_time_str)
            except (ValueError, TypeError):
                _LOGGER.warning(
                    "Delayed action '%s': finish_time could not be parsed: %s",
                    self._attr_name,
                    finish_time_str,
                )
                self._status = STATUS_CANCELLED
                return

            now = datetime.now(timezone.utc)
            # Treat naive finish_time as UTC
            if finish_time.tzinfo is None:
                finish_time = finish_time.replace(tzinfo=timezone.utc)

            if finish_time <= now:
                # Time already passed -> run immediately
                _LOGGER.info(
                    "Delayed action '%s': time passed during restart, running immediately",
                    self._attr_name,
                )
                self._remaining = timedelta(0)
                # Fire immediately (async)
                self.hass.async_create_task(self._timer_finished(now))
            else:
                # Continue with the remaining time
                self._delay = finish_time - now
                self._remaining = self._delay
                self._finish_time = finish_time
                self._is_on = True
                self._cancel_timer_job = async_call_later(
                    self.hass, self._delay, self._timer_finished
                )
                self._cancel_interval = async_track_time_interval(
                    self.hass,
                    self._update_remaining,
                    _REMAINING_UPDATE_INTERVAL,
                )
                self.async_write_ha_state()
                _LOGGER.info(
                    "Delayed action '%s' continuing after restart, remaining: %ss",
                    self._attr_name,
                    int(self._remaining.total_seconds()),
                )

    async def async_will_remove_from_hass(self):
        """Clean up listeners when the entity is removed."""
        self._cleanup_listeners()
        await super().async_will_remove_from_hass()
