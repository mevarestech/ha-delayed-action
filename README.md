# Delayed Action — Home Assistant Custom Integration

Trigger any entity's state change or any service call after a configurable delay — with a live countdown, a sidebar panel, a Lovelace card, and full service support.

## Features

- **Any service**: `light.turn_off`, `climate.set_temperature`, `media_player.play_media` — anything callable
- **Simple on/off mode**: provide `entity_id` + `action` (`turn_on`/`turn_off`), the domain service is derived automatically
- **Timer entities**: every timer is a `delayed_action.*` entity — remaining time, status and target info are exposed as attributes
- **Four ways to use it**:
  1. **Service** (`delayed_action.run_later`): dynamic/temporary timers (automations, scripts, dashboard buttons)
  2. **Config Flow**: persistent timers (Settings → Devices & Services → Add → Delayed Action)
  3. **Sidebar panel**: a full-screen UI to manage all timers
  4. **Lovelace card**: a countdown card for a single timer on your dashboard
- **Unlimited concurrent timers** — even multiple timers for the same entity
- **Survives restarts**: running timers are restored from `finish_time` (expired timers fire immediately)
- **Cancel** via the `delayed_action.cancel` service or the entity's `turn_off`
- **Permanent delete**: cancelling a timer removes its entity, registry entry and — for persistent timers — the config entry, so deleted timers never reappear after a restart

---

## Installation

### Option A: HACS (recommended)

1. HACS → **Custom repositories** → add this repo URL, category: **Integration**
2. Search for **Delayed Action** → **Install**
3. Restart Home Assistant

### Option B: Manual

1. Copy `custom_components/delayed_action` into your HA config folder:

```
<HA_CONFIG>/
└── custom_components/
    └── delayed_action/
        ├── manifest.json
        ├── __init__.py
        ├── const.py
        ├── config_flow.py
        ├── services.py
        ├── services.yaml
        ├── timer.py
        ├── strings.json
        ├── translations/
        └── www/
            ├── delayed-action-panel.js
            ├── delayed-action-card.js
            └── delayed-action-card-editor.js
```

2. Restart Home Assistant
3. Clear your browser cache (`Cmd+Shift+R` / `Ctrl+F5`) so the new JS files load

> The 3 JS files under `www/` are automatically copied into `config/www/` when the integration starts. If the panel or card doesn't show up, copy them manually and clear the cache.

### Verify

- Sidebar shows **Delayed Action**
- Developer Tools → Services lists `delayed_action.run_later` and `delayed_action.cancel`

---

## Usage

### Sidebar Panel

Click **Delayed Action** in the sidebar.

- **New Timer** button opens the creation form:
  - Pick a target entity (searchable dropdown)
  - Action: Turn on / Turn off
  - Duration: `600`, `10m`, `1h30m`, `00:10:00`
  - Optional name
- Each card shows a live countdown with a progress ring
- **Start / Stop / Delete** buttons per card

### Service

#### Turn off a light after 10 minutes

```yaml
service: delayed_action.run_later
data:
  entity_id: light.living_room
  action: turn_off
  delay: 600
  name: Living room light off in 10 min
```

#### Set climate to 22°C after 5 minutes

```yaml
service: delayed_action.run_later
data:
  service: climate.set_temperature
  service_data:
    entity_id: climate.living_room
    temperature: 22
  delay:
    minutes: 5
```

#### Cancel a timer

```yaml
service: delayed_action.cancel
data:
  entity_id: delayed_action.a1b2c3d4e5f6
```

### Config Flow (persistent timers)

1. Settings → Devices & Services → Add → **Delayed Action**
2. Fill in the form (name, target entity, action, delay in seconds)
3. A `delayed_action.<entry_id>` entity is created — toggle it on to start

> Persistent timers survive restarts and resume with the correct remaining time. Timers created via the service are dynamic and do not persist across restarts.

### Lovelace Card

```yaml
type: custom:delayed-action-card
entity: delayed_action.a1b2c3d4e5f6
name: Living room light
compact: false
```

| Option | Description | Required |
|--------|-------------|----------|
| `entity` | A `delayed_action.*` entity | Yes |
| `name` | Display name (defaults to target entity name) | No |
| `compact` | Compact layout | No |

---

## Duration Formats

| Format | Meaning |
|--------|---------|
| `600` | 600 seconds |
| `10m` | 10 minutes |
| `1h30m` | 1 hour 30 minutes |
| `1h30m15s` | 1 hour 30 minutes 15 seconds |
| `00:10:00` | 10 minutes (HH:MM:SS) |
| `10:00` | 10 minutes (MM:SS) |
| `{ minutes: 5 }` | 5 minutes (dict in service calls) |

## Entity Attributes

| Attribute | Description |
|-----------|-------------|
| `status` | `idle` / `running` / `finished` / `cancelled` |
| `remaining` | Remaining time (seconds) |
| `duration` | Total duration (seconds) |
| `finish_time` | Finish timestamp (ISO, while running) |
| `target_entity` | Target entity_id |
| `target_service` | Service that will be called |
| `target_service_data` | Data passed to the service |

---

## Troubleshooting

- **Panel not visible**: check `config/www/delayed-action-panel.js` exists and clear the browser cache
- **Card not listed**: check `config/www/delayed-action-card.js` exists and clear the browser cache
- **Timer not firing**: check the entity's `status` attribute is `running` and `remaining` is decreasing

## License

MIT — see [LICENSE](LICENSE).
