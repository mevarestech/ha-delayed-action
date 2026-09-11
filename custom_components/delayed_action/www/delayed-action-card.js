/**
 * Delayed Action Card — Native Web Components
 * No external dependencies. Zero external imports.
 *
 * Config:
 *   type: custom:delayed-action-card
 *   entity: delayed_action.xxx
 *   name: "Living room light" (optional override)
 *   compact: false (optional)
 */
class DelayedActionCard extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._config = null;
    this._remaining = 0;
    this._tickHandle = null;
    this._lastState = undefined;
    this._lastAttrs = null;
    this._shadow = this.attachShadow({ mode: "open" });
    this._renderStyles();
  }

  static getStubConfig() {
    return { entity: "", name: "" };
  }

  static async getConfigElement() {
    await import("/local/delayed-action-card-editor.js?v=1.1.1");
    return document.createElement("delayed-action-card-editor");
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("entity is required");
    }
    this._config = { name: "", compact: false, ...config };
    this._remaining = 0;
    this._lastState = undefined;
    this._lastAttrs = null;
    this._stopTick();
    this._render();
  }

  set hass(hass) {
    this._hass = hass;

    const stateObj = this._getState();
    if (!stateObj) {
      this._render();
      return;
    }

    const newState = stateObj.state;
    const newAttrs = stateObj.attributes;
    const oldState = this._lastState;
    const oldAttrs = this._lastAttrs || {};

    const stateChanged = oldState !== newState;
    const durationChanged = (oldAttrs.duration || 0) !== (newAttrs.duration || 0);
    const targetChanged =
      oldAttrs.target_entity !== newAttrs.target_entity ||
      oldAttrs.target_service !== newAttrs.target_service;
    const nameChanged = oldAttrs.friendly_name !== newAttrs.friendly_name;

    this._remaining = newAttrs.remaining || 0;

    if (stateChanged) {
      if (newState === "on") {
        this._startTick();
      } else {
        this._stopTick();
      }
    }

    if (stateChanged || durationChanged || targetChanged || nameChanged) {
      this._render();
    } else {
      this._updateCountdowns();
    }

    this._lastState = newState;
    this._lastAttrs = { ...newAttrs };
  }

  _startTick() {
    this._stopTick();
    this._tickHandle = setInterval(() => {
      if (this._remaining > 0) {
        this._remaining = Math.max(0, this._remaining - 1);
        this._updateCountdowns();
      } else {
        this._stopTick();
      }
    }, 1000);
  }

  _stopTick() {
    if (this._tickHandle) {
      clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
  }

  disconnectedCallback() {
    this._stopTick();
  }

  _getState() {
    return this._hass?.states[this._config.entity];
  }

  _getStatus() {
    const stateObj = this._getState();
    if (!stateObj) return "idle";
    if (stateObj.state === "on") return "running";
    return stateObj.attributes.status || "idle";
  }

  _getDuration() {
    return this._getState()?.attributes.duration || 0;
  }

  _getTargetEntity() {
    return this._getState()?.attributes.target_entity;
  }

  _getTargetService() {
    return this._getState()?.attributes.target_service || "";
  }

  _getActionLabel() {
    const service = this._getTargetService();
    if (service.endsWith(".turn_on")) return "Turn on";
    if (service.endsWith(".turn_off")) return "Turn off";
    if (service) return service.split(".").pop().replace(/_/g, " ");
    return "";
  }

  _getTargetIcon() {
    const target = this._getTargetEntity();
    if (!target || !this._hass) return "mdi:timer-outline";
    const stateObj = this._hass.states[target];
    return stateObj?.attributes.icon || "mdi:flash";
  }

  _getTargetName() {
    const target = this._getTargetEntity();
    if (!target || !this._hass) return this._getTargetService();
    const stateObj = this._hass.states[target];
    return stateObj?.attributes.friendly_name || target;
  }

  async _toggleTimer() {
    const stateObj = this._getState();
    if (!stateObj) return;
    const service = stateObj.state === "on" ? "turn_off" : "turn_on";
    try {
      await this._hass.callService("homeassistant", service, { entity_id: this._config.entity });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Card toggle failed:", e);
    }
  }

  _getProgress() {
    const duration = this._getDuration();
    if (!duration) return 0;
    const remaining = this._remaining;
    const elapsed = duration - remaining;
    return Math.min(1, Math.max(0, elapsed / duration));
  }

  _formatTime(seconds) {
    if (seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  _statusColor(status) {
    const colors = { running: "#03a9f4", finished: "#4caf50", cancelled: "#9e9e9e", idle: "#607d8b" };
    return colors[status] || colors.idle;
  }

  _statusLabel(status) {
    const labels = { running: "Running", finished: "Finished", cancelled: "Cancelled", idle: "Idle" };
    return labels[status] || status;
  }

  _htmlEscape(str) {
    if (str == null) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  _renderStyles() {
    this._shadow.innerHTML = `<style>
      :host { display: block; font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
      .card { padding: 16px; border-radius: 16px; background: var(--card-background-color, #1e1e1e); box-shadow: 0 4px 20px rgba(0,0,0,0.15); color: var(--primary-text-color, #fff); }
      .error { padding: 16px; color: var(--error-color, #f44336); }
      .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .title-row { display: flex; align-items: center; gap: 10px; }
      .title-icon { width: 28px; height: 28px; color: var(--card-color, #03a9f4); }
      .titles { display: flex; flex-direction: column; }
      .name { font-size: 16px; font-weight: 600; line-height: 1.2; }
      .action { font-size: 12px; color: var(--secondary-text-color, #aaa); margin-top: 2px; }
      .badge { font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
      .body { display: flex; justify-content: center; align-items: center; padding: 8px 0; }
      .ring-container { position: relative; width: var(--size); height: var(--size); }
      .countdown { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; }
      .time { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 1px; }
      .total { font-size: 12px; color: var(--secondary-text-color, #888); margin-top: 2px; }
      .footer { display: flex; justify-content: center; margin-top: 8px; }
      .action-btn { border: none; border-radius: 20px; padding: 10px 24px; font-size: 14px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
      .action-btn.start { background: #4caf50; color: #fff; }
      .action-btn.stop { background: #f44336; color: #fff; }
      .action-btn:disabled { background: #9e9e9e; color: #fff; cursor: default; }
      .compact .time { font-size: 22px; }
      .compact .name { font-size: 14px; }
    </style><div id="root"></div>`;
    this._root = this._shadow.getElementById("root");
  }

  _render() {
    if (!this._root) return;
    const stateObj = this._getState();
    if (!stateObj) {
      this._root.innerHTML = `<div class="error">Entity not found: ${this._htmlEscape(this._config.entity)}</div>`;
      return;
    }

    const status = this._getStatus();
    const color = this._statusColor(status);
    const duration = this._getDuration();
    const progress = this._getProgress();
    const isRunning = status === "running";
    const name = this._config.name || this._getTargetName();
    const actionLabel = this._getActionLabel();
    const targetIcon = this._getTargetIcon();
    const compact = this._config.compact;

    const size = compact ? 120 : 160;
    const stroke = compact ? 8 : 10;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference * (1 - progress);

    let btnLabel, btnClass, btnIcon, btnDisabled;
    if (isRunning) {
      btnLabel = "Stop"; btnClass = "stop";
      btnIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>`;
      btnDisabled = false;
    } else if (status === "finished") {
      btnLabel = "Finished"; btnClass = "start";
      btnIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>`;
      btnDisabled = true;
    } else if (status === "cancelled") {
      btnLabel = "Cancelled"; btnClass = "start";
      btnIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>`;
      btnDisabled = true;
    } else {
      btnLabel = "Start"; btnClass = "start";
      btnIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
      btnDisabled = false;
    }

    this._root.innerHTML = `<div class="card ${compact ? "compact" : ""}" style="--card-color:${color};--size:${size}px">
      <div class="header">
        <div class="title-row">
          <ha-icon icon="${this._htmlEscape(targetIcon)}" class="title-icon"></ha-icon>
          <div class="titles">
            <div class="name">${this._htmlEscape(name)}</div>
            <div class="action">${this._htmlEscape(actionLabel)} · ${this._htmlEscape(this._getTargetService())}</div>
          </div>
        </div>
        <div class="badge" style="background:${color}22;color:${color}">${this._statusLabel(status)}</div>
      </div>
      <div class="body">
        <div class="ring-container">
          <svg width="${size}" height="${size}">
            <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="var(--divider-color, rgba(255,255,255,0.1))" stroke-width="${stroke}"/>
            <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
              stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}" transform="rotate(-90 ${size/2} ${size/2})"
              style="transition:stroke-dashoffset 1s linear;filter:drop-shadow(0 0 6px ${color})"/>
          </svg>
          <div class="countdown">
            <div class="time">${this._formatTime(this._remaining)}</div>
            ${duration > 0 ? `<div class="total">/ ${this._formatTime(duration)}</div>` : ""}
          </div>
        </div>
      </div>
      <div class="footer">
        <button class="action-btn ${btnClass}" id="btn-toggle" ${btnDisabled ? "disabled" : ""}>
          ${btnIcon} ${btnLabel}
        </button>
      </div>
    </div>`;

    const btn = this._shadow.getElementById("btn-toggle");
    if (btn && !btnDisabled) {
      btn.onclick = () => this._toggleTimer();
    }
  }

  _updateCountdowns() {
    if (!this._root) return;
    const timeEl = this._root.querySelector(".time");
    if (timeEl) timeEl.textContent = this._formatTime(this._remaining);

    const totalEl = this._root.querySelector(".total");
    const duration = this._getDuration();
    if (totalEl) totalEl.textContent = duration > 0 ? `/ ${this._formatTime(duration)}` : "";

    const progress = this._getProgress();
    const compact = this._config.compact;
    const size = compact ? 120 : 160;
    const stroke = compact ? 8 : 10;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference * (1 - progress);

    const circle = this._root.querySelector("circle[stroke-dasharray]");
    if (circle) circle.setAttribute("stroke-dashoffset", dashOffset);
  }
}

customElements.define("delayed-action-card", DelayedActionCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "delayed-action-card",
  name: "Delayed Action Card",
  description: "Countdown timer card — progress ring, remaining time, start/stop.",
});
