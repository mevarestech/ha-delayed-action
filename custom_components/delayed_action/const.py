"""Constants for the Delayed Action integration."""
from __future__ import annotations

import re
from datetime import timedelta

DOMAIN = "delayed_action"

# hass.data layout: hass.data[DOMAIN] = {DATA_TIMERS: {timer_id: entity}}
DATA_TIMERS = "timers"
DATA_ENTITY_COMPONENT = "entity_component"

# Services
SERVICE_RUN_LATER = "run_later"
SERVICE_CANCEL = "cancel"

# Service parameters
ATTR_ENTITY_ID = "entity_id"
ATTR_SERVICE = "service"
ATTR_SERVICE_DATA = "service_data"
ATTR_ACTION = "action"
ATTR_DELAY = "delay"
ATTR_NAME = "name"
ATTR_TIMER_ID = "timer_id"

# Action types
ACTION_TURN_ON = "turn_on"
ACTION_TURN_OFF = "turn_off"
ACTION_CUSTOM = "custom"

ACTIONS = [ACTION_TURN_ON, ACTION_TURN_OFF, ACTION_CUSTOM]

# Timer statuses
STATUS_IDLE = "idle"
STATUS_RUNNING = "running"
STATUS_FINISHED = "finished"
STATUS_CANCELLED = "cancelled"

# Entity attributes
ATTR_STATUS = "status"
ATTR_REMAINING = "remaining"
ATTR_FINISH_TIME = "finish_time"
ATTR_TARGET_ENTITY = "target_entity"
ATTR_TARGET_SERVICE = "target_service"
ATTR_TARGET_SERVICE_DATA = "target_service_data"
ATTR_DURATION = "duration"

# Config flow fields
CONF_TARGET_ENTITY = "target_entity"
CONF_ACTION = "action"
CONF_SERVICE = "service"
CONF_SERVICE_DATA = "service_data"
CONF_DELAY_SECONDS = "delay_seconds"

# Defaults
DEFAULT_DELAY_SECONDS = 600
DEFAULT_NAME = "Delayed Action"

# --- Delay parsing helpers ---

_DELAY_STRING_PATTERN = re.compile(r"^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$")


def _parse_delay_string(delay: str) -> timedelta:
    """Convert a delay string into a timedelta.

    Supported formats:
      - "600" (seconds)
      - "10m", "1h30m", "1h30m15s"
      - "00:10:00" (HH:MM:SS), "10:00" (MM:SS)
    """
    delay = delay.strip()
    if not delay:
        raise ValueError("Empty delay value")

    if delay.isdigit():
        return timedelta(seconds=int(delay))

    if ":" in delay:
        parts = delay.split(":")
        if len(parts) == 2:
            minutes, seconds = int(parts[0]), int(parts[1])
            return timedelta(minutes=minutes, seconds=seconds)
        if len(parts) == 3:
            hours, minutes, seconds = int(parts[0]), int(parts[1]), int(parts[2])
            return timedelta(hours=hours, minutes=minutes, seconds=seconds)
        raise ValueError(f"Invalid time format: {delay}")

    match = _DELAY_STRING_PATTERN.match(delay)
    if not match or not any(match.groups()):
        raise ValueError(f"Invalid delay format: {delay}")

    hours, minutes, seconds = (int(g) if g else 0 for g in match.groups())
    return timedelta(hours=hours, minutes=minutes, seconds=seconds)


def parse_delay(delay) -> timedelta:
    """Convert the delay parameter of a service call into a timedelta.

    Accepted formats:
      - int/float: seconds
      - dict: {"hours": h, "minutes": m, "seconds": s} (any subset)
      - timedelta: returned as-is
      - str: "600", "10m", "1h30m", "00:10:00"
    """
    if isinstance(delay, timedelta):
        return delay
    if isinstance(delay, (int, float)):
        return timedelta(seconds=float(delay))
    if isinstance(delay, dict):
        return timedelta(
            hours=float(delay.get("hours", 0)),
            minutes=float(delay.get("minutes", 0)),
            seconds=float(delay.get("seconds", 0)),
        )
    if isinstance(delay, str):
        return _parse_delay_string(delay)
    raise ValueError(f"Invalid delay format: {delay!r}")
