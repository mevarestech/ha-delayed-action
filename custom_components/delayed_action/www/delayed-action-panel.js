/**
 * Delayed Action Panel — Native Web Components
 * No external dependencies. Zero external imports.
 */
const PANEL_VERSION = "1.1.1";
console.log(`DelayedActionPanel v${PANEL_VERSION} loaded`);

class DelayedActionPanel extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._timers = [];
    this._lastRenderedTimers = null;
    this._showForm = false;
    this._formEntity = "";
    this._formAction = "turn_off";
    this._formService = "";
    this._formDelay = "10m";
    this._formName = "";
    this._busy = false;
    this._error = "";
    this._entitySearch = "";
    this._shadow = this.attachShadow({ mode: "open" });
    this._renderStyles();
  }

  set hass(hass) {
    this._hass = hass;
    this._refreshTimers();
    this._maybeUpdate();
  }

  connectedCallback() {
    this.addEventListener("click", this._onClick);
    this._render();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this._onClick);
  }

  _refreshTimers() {
    if (!this._hass) return;
    const states = this._hass.states;
    const nowMs = Date.now();
    const timers = [];
    for (const [entityId, stateObj] of Object.entries(states)) {
      if (!entityId.startsWith("delayed_action.")) continue;
      const attrs = stateObj.attributes;
      let remaining = attrs.remaining || 0;
      // If finish_time exists, compute the real remaining time from it
      // (prevents the countdown from jumping back and forth)
      if (attrs.finish_time) {
        const finishMs = new Date(attrs.finish_time).getTime();
        remaining = Math.max(0, Math.floor((finishMs - nowMs) / 1000));
      }
      timers.push({
        entity_id: entityId,
        name: attrs.friendly_name || entityId,
        status: stateObj.state === "on" ? "running" : (attrs.status || "idle"),
        remaining,
        duration: attrs.duration || 0,
        target_entity: attrs.target_entity || "",
        target_service: attrs.target_service || "",
        target_service_data: attrs.target_service_data || {},
        finish_time: attrs.finish_time || null,
      });
    }
    const order = { running: 0, idle: 1, finished: 2, cancelled: 3 };
    timers.sort((a, b) => (order[a.status] || 9) - (order[b.status] || 9));
    this._timers = timers;
  }

  _formatTime(seconds) {
    if (seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  _parseDelayInput(value) {
    if (!value) return null;
    value = value.trim().toLowerCase();
    if (/^\d+$/.test(value)) return parseInt(value, 10);
    const match = value.match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/);
    if (match) {
      const h = parseInt(match[1] || 0, 10);
      const m = parseInt(match[2] || 0, 10);
      const s = parseInt(match[3] || 0, 10);
      return h * 3600 + m * 60 + s;
    }
    const parts = value.split(":");
    if (parts.length === 3) {
      return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
    }
    if (parts.length === 2) {
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    }
    return null;
  }

  _getActionLabel(service) {
    if (!service) return "";
    if (service.endsWith(".turn_on")) return "Turn on";
    if (service.endsWith(".turn_off")) return "Turn off";
    return service.split(".").pop().replace(/_/g, " ");
  }

  _getEntityIcon(entityId) {
    if (!entityId || !this._hass) return "mdi:timer-outline";
    const stateObj = this._hass.states[entityId];
    return stateObj?.attributes?.icon || "mdi:flash";
  }

  _getEntityName(entityId) {
    if (!entityId || !this._hass) return entityId || "";
    const stateObj = this._hass.states[entityId];
    return stateObj?.attributes?.friendly_name || entityId;
  }

  _getAllEntities() {
    if (!this._hass) return [];
    const domains = [
      "light", "switch", "fan", "input_boolean", "group",
      "humidifier", "siren", "climate", "media_player",
      "automation", "script", "scene"
    ];
    return Object.keys(this._hass.states)
      .filter((id) => domains.includes(id.split(".")[0]))
      .sort()
      .map((id) => {
        const s = this._hass.states[id];
        return {
          entity_id: id,
          name: s?.attributes?.friendly_name || id,
          icon: s?.attributes?.icon || "mdi:flash",
        };
      });
  }

  _htmlEscape(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  _onClick(e) {
    const target = e.composedPath()[0];
    const btn = target.closest("[data-action]");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const entityId = btn.dataset.entity;
      const action = btn.dataset.action;
      if (action === "start") this._toggleTimer(entityId, false);
      else if (action === "stop") this._toggleTimer(entityId, true);
      else if (action === "delete") this._cancelTimer(entityId);
      return;
    }
    const newBtn = target.closest("#btn-new");
    if (newBtn) {
      e.preventDefault();
      e.stopPropagation();
      this._openForm();
    }
  }

  async _toggleTimer(entityId, isRunning) {
    const service = isRunning ? "turn_off" : "turn_on";
    try {
      await this._hass.callService("homeassistant", service, { entity_id: entityId });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Timer toggle failed:", e);
    }
  }

  async _cancelTimer(entityId) {
    try {
      await this._hass.callService("delayed_action", "cancel", { entity_id: entityId });
      this._refreshTimers();
      this._maybeUpdate();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Timer cancel failed:", e);
    }
  }

  _resetForm() {
    this._formEntity = "";
    this._formAction = "turn_off";
    this._formService = "";
    this._formDelay = "10m";
    this._formName = "";
    this._entitySearch = "";
    this._error = "";
    this._busy = false;
  }

  _setFormError(msg) {
    const errEl = this._shadow.getElementById("form-error");
    if (!errEl) return;
    if (msg) {
      errEl.innerHTML = this._htmlEscape(msg);
      errEl.style.display = "block";
    } else {
      errEl.innerHTML = "";
      errEl.style.display = "none";
    }
  }

  _setCreateButtonBusy(busy) {
    const btn = this._shadow.getElementById("btn-create");
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? "Creating..." : "Create";
  }

  async _submitForm() {
    this._error = "";
    this._setFormError("");

    const delaySeconds = this._parseDelayInput(this._formDelay);
    if (delaySeconds === null || delaySeconds <= 0) {
      this._error = "Invalid duration. Examples: 600, 10m, 1h30m, 00:10:00";
      this._setFormError(this._error);
      return;
    }
    if (!this._formEntity) {
      this._error = "Select a target entity";
      this._setFormError(this._error);
      return;
    }

    this._busy = true;
    this._setCreateButtonBusy(true);

    try {
      const data = { delay: delaySeconds };
      if (this._formName) data.name = this._formName;
      data.entity_id = this._formEntity;
      data.action = this._formAction;
      await this._hass.callService("delayed_action", "run_later", data);
      this._resetForm();
      this._closeForm();
      setTimeout(() => {
        this._refreshTimers();
        this._maybeUpdate();
      }, 500);
    } catch (e) {
      this._error = e.message || "Service call failed";
      this._setFormError(this._error);
    } finally {
      this._busy = false;
      this._setCreateButtonBusy(false);
    }
  }

  _openForm() {
    this._showForm = true;
    this._error = "";
    this._resetForm();
    this._render();
    const searchInp = this._shadow.getElementById("inp-entity-search");
    if (searchInp) searchInp.focus();
  }

  _closeForm() {
    this._showForm = false;
    this._error = "";
    this._render();
  }

  _renderStyles() {
    this._shadow.innerHTML = `<style>
      :host { display: block; font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
      .panel { max-width: 1200px; margin: 0 auto; padding: 24px 16px; color: var(--primary-text-color, #fff); }
      .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
      .header-left { display: flex; align-items: center; gap: 12px; }
      .header-icon { width: 36px; height: 36px; color: var(--primary-color, #03a9f4); }
      h1 { font-size: 28px; font-weight: 700; margin: 0; }
      .count-badge { background: var(--primary-color, #03a9f4); color: #fff; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 12px; }
      .new-btn { background: var(--primary-color, #03a9f4); color: #fff; border: none; border-radius: 20px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; }
      .new-btn:hover { filter: brightness(1.1); }
      .empty { text-align: center; padding: 80px 20px; color: var(--secondary-text-color, #888); }
      .empty-icon { width: 64px; height: 64px; opacity: 0.4; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
      .timer-card { background: var(--card-background-color, #1e1e1e); border-radius: 16px; padding: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); display: flex; flex-direction: column; }
      .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
      .card-title-row { display: flex; align-items: center; gap: 8px; }
      .card-icon { width: 24px; height: 24px; color: var(--card-color, #607d8b); }
      .card-titles { display: flex; flex-direction: column; }
      .card-name { font-size: 15px; font-weight: 600; line-height: 1.2; }
      .card-target { font-size: 11px; color: var(--secondary-text-color, #888); margin-top: 2px; }
      .badge { font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.4px; white-space: nowrap; }
      .card-body { display: flex; justify-content: center; padding: 8px 0; }
      .ring-wrap { position: relative; width: 110px; height: 110px; }
      .ring-center { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; }
      .time { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
      .total { font-size: 11px; color: var(--secondary-text-color, #888); }
      .card-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
      .btn { border: none; border-radius: 16px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
      .btn-start { background: #4caf50; color: #fff; }
      .btn-stop { background: #f44336; color: #fff; }
      .btn-done { background: #9e9e9e; color: #fff; cursor: default; }
      .btn-delete { background: transparent; color: var(--secondary-text-color, #888); border: 1px solid var(--divider-color, rgba(255,255,255,0.1)); border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
      .form-root { display: none; }
      .form-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 999; }
      .form-card { background: var(--card-background-color, #1e1e1e); border-radius: 16px; width: 90%; max-width: 480px; max-height: 90vh; overflow-y: auto; box-shadow: 0 8px 40px rgba(0,0,0,0.3); }
      .form-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--divider-color, rgba(255,255,255,0.08)); }
      .form-header h2 { font-size: 20px; margin: 0; }
      .form-close { background: transparent; border: none; color: var(--secondary-text-color, #888); font-size: 20px; cursor: pointer; }
      .form-body { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
      .field { display: flex; flex-direction: column; gap: 6px; }
      .field label { font-size: 13px; font-weight: 600; color: var(--secondary-text-color, #aaa); }
      .field input, .field select { background: var(--card-background-color, #1e1e1e); color: var(--primary-text-color, #fff); border: 1px solid var(--divider-color, rgba(255,255,255,0.1)); border-radius: 8px; padding: 10px 12px; font-size: 14px; }
      .hint { font-size: 11px; color: var(--secondary-text-color, #888); }
      .entity-search { position: relative; }
      .entity-search input { width: 100%; background: var(--card-background-color, #1e1e1e); color: var(--primary-text-color, #fff); border: 1px solid var(--divider-color, rgba(255,255,255,0.1)); border-radius: 8px; padding: 10px 12px 10px 36px; font-size: 14px; box-sizing: border-box; }
      .entity-search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; color: var(--secondary-text-color, #888); pointer-events: none; }
      .entity-results { margin-top: 4px; max-height: 200px; overflow-y: auto; border: 1px solid var(--divider-color, rgba(255,255,255,0.1)); border-radius: 8px; background: var(--card-background-color, #1e1e1e); }
      .entity-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--divider-color, rgba(255,255,255,0.05)); }
      .entity-item:hover { background: rgba(255,255,255,0.05); }
      .entity-item.selected { background: var(--primary-color, #03a9f4); color: #fff; }
      .entity-item-icon { width: 20px; height: 20px; flex-shrink: 0; }
      .entity-item-info { flex: 1; min-width: 0; }
      .entity-item-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .entity-item-id { font-size: 11px; color: var(--secondary-text-color, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .entity-item.selected .entity-item-id { color: rgba(255,255,255,0.7); }
      .entity-selected { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: var(--card-background-color, #1e1e1e); border: 1px solid var(--primary-color, #03a9f4); border-radius: 8px; }
      .entity-selected-name { flex: 1; font-size: 14px; }
      .entity-selected-clear { background: transparent; border: none; color: var(--secondary-text-color, #888); cursor: pointer; font-size: 18px; padding: 0 4px; }
      .error { background: rgba(244,67,54,0.15); color: #f44336; padding: 10px 14px; border-radius: 8px; font-size: 13px; }
      .form-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 20px; border-top: 1px solid var(--divider-color, rgba(255,255,255,0.08)); }
      .btn-create { background: #4caf50; color: #fff; }
      .btn-cancel { background: transparent; color: var(--secondary-text-color, #aaa); border: 1px solid var(--divider-color, rgba(255,255,255,0.1)); }
    </style><div id="root"></div><div id="form-root" class="form-root"></div>`;
    this._root = this._shadow.getElementById("root");
    this._formRoot = this._shadow.getElementById("form-root");
  }

  _structuralSnapshot(timers) {
    return timers.map((t) => ({
      entity_id: t.entity_id,
      name: t.name,
      status: t.status,
      duration: t.duration,
      target_entity: t.target_entity,
      target_service: t.target_service,
    }));
  }

  _needsFullRender() {
    const old = this._lastRenderedTimers;
    const neu = this._structuralSnapshot(this._timers);
    if (!old || old.length !== neu.length) return true;
    return old.some((ot, i) => {
      const nt = neu[i];
      return ot.entity_id !== nt.entity_id ||
        ot.name !== nt.name ||
        ot.status !== nt.status ||
        ot.duration !== nt.duration ||
        ot.target_entity !== nt.target_entity ||
        ot.target_service !== nt.target_service;
    });
  }

  _maybeUpdate() {
    if (this._showForm) return;
    if (!this._root) return;
    if (this._needsFullRender()) {
      this._render();
    } else {
      this._updateCountdowns();
    }
  }

  _render() {
    if (!this._root || !this._formRoot) return;
    const runningCount = this._timers.filter((t) => t.status === "running").length;

    let panelHtml = `<div class="panel">
      <div class="header">
        <div class="header-left">
          <svg class="header-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M12 20c4.4 0 8-3.6 8-8s-3.6-8-8-8-8 3.6-8 8 3.6 8 8 8m0-18c5.5 0 10 4.5 10 10s-4.5 10-10 10S2 17.5 2 12 6.5 2 12 2m.5 5v5.2l4 2.4-.8 1.3-4.7-2.8V7H12.5z"/></svg>
          <h1>Delayed Action</h1>
          <span class="count-badge">${runningCount} active</span>
        </div>
        <button type="button" class="new-btn" id="btn-new">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          New Timer
        </button>
      </div>`;

    if (this._timers.length === 0) {
      panelHtml += `<div class="empty">
        <svg class="empty-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2m0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8M7.5 12l4.5 4.5L19.5 9l-1.5-1.5-5.5 5.5-3-3L7.5 12z" opacity="0.5"/></svg>
        <p>No timers yet. Start with "New Timer".</p>
      </div>`;
    } else {
      panelHtml += `<div class="grid">${this._timers.map((t) => this._renderTimerCard(t)).join("")}</div>`;
    }

    panelHtml += `</div>`;

    this._root.innerHTML = panelHtml;
    this._lastRenderedTimers = this._structuralSnapshot(this._timers);
    this._attachPanelListeners();

    if (this._showForm) {
      this._formRoot.innerHTML = this._renderForm();
      this._formRoot.style.display = "flex";
      this._attachFormListeners();
    } else {
      this._formRoot.innerHTML = "";
      this._formRoot.style.display = "none";
    }
  }

  _renderForm() {
    const entities = this._getAllEntities();

    let entityFieldHtml;
    if (this._formEntity) {
      const ent = entities.find((e) => e.entity_id === this._formEntity);
      const entName = ent ? ent.name : this._formEntity;
      const entIcon = ent ? ent.icon : "mdi:flash";
      entityFieldHtml = `<div class="field">
            <label>Target Entity</label>
            <div class="entity-selected">
              <ha-icon icon="${this._htmlEscape(entIcon)}" class="entity-item-icon"></ha-icon>
              <span class="entity-selected-name">${this._htmlEscape(entName)}</span>
              <button class="entity-selected-clear" id="btn-clear-entity" aria-label="Clear selection">×</button>
            </div>
          </div>`;
    } else {
      entityFieldHtml = `<div class="field">
            <label>Target Entity</label>
            <div class="entity-search">
              <svg class="entity-search-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M9.5 3A6.5 6.5 0 0 1 16 9.5c0 1.61-.59 3.09-1.56 4.23l.27.27h.79l5 5-1.5 1.5-5-5v-.79l-.27-.27A6.516 6.516 0 0 1 9.5 16 6.5 6.5 0 0 1 3 9.5 6.5 6.5 0 0 1 9.5 3m0 2C7 5 5 7 5 9.5S7 14 9.5 14 14 12 14 9.5 12 5 9.5 5z"/></svg>
              <input id="inp-entity-search" type="text" placeholder="Search entity... (e.g. living room, light, plug)" value="${this._htmlEscape(this._entitySearch)}" autocomplete="off">
            </div>
            <div class="entity-results" id="entity-results"></div>
          </div>`;
    }

    let html = `<div class="form-overlay" id="form-overlay">
      <div class="form-card" role="dialog" aria-modal="true" aria-labelledby="form-title">
        <div class="form-header">
          <h2 id="form-title">New Timer</h2>
          <button type="button" class="form-close" id="form-close" aria-label="Close">×</button>
        </div>
        <div class="form-body" id="form-body">
          <div class="field">
            <label for="inp-name">Name (optional)</label>
            <input id="inp-name" type="text" placeholder="Turn off living room light in 10 min" value="${this._htmlEscape(this._formName)}">
          </div>
          ${entityFieldHtml}`;

    if (this._formEntity) {
      html += `<div class="field">
            <label for="inp-action">Action</label>
            <select id="inp-action">
              <option value="turn_on" ${this._formAction === "turn_on" ? "selected" : ""}>Turn on (turn_on)</option>
              <option value="turn_off" ${this._formAction === "turn_off" ? "selected" : ""}>Turn off (turn_off)</option>
            </select>
          </div>`;
    }

    html += `<div class="field">
            <label for="inp-delay">Duration</label>
            <input id="inp-delay" type="text" placeholder="600, 10m, 1h30m, 00:10:00" value="${this._htmlEscape(this._formDelay)}">
            <div class="hint">Seconds (600), minutes (10m), hours+minutes (1h30m), or HH:MM:SS</div>
          </div>
          <div class="error" id="form-error" style="display:none" role="alert"></div>
        </div>
        <div class="form-footer">
          <button type="button" class="btn btn-cancel" id="btn-cancel">Cancel</button>
          <button type="button" class="btn btn-create" id="btn-create" ${this._busy ? "disabled" : ""}>${this._busy ? "Creating..." : "Create"}</button>
        </div>
      </div>
    </div>`;

    return html;
  }

  _renderEntityResults() {
    const resultsEl = this._shadow.getElementById("entity-results");
    if (!resultsEl) return;

    const entities = this._getAllEntities();
    const searchTerm = this._entitySearch || "";
    const q = searchTerm.toLowerCase();
    const filtered = entities
      .filter((e) => e.name.toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q))
      .slice(0, 50);

    resultsEl.innerHTML = filtered.length > 0
      ? filtered.map((e) =>
          `<div class="entity-item" data-entity="${this._htmlEscape(e.entity_id)}">
            <ha-icon icon="${this._htmlEscape(e.icon)}" class="entity-item-icon"></ha-icon>
            <div class="entity-item-info">
              <div class="entity-item-name">${this._htmlEscape(e.name)}</div>
              <div class="entity-item-id">${this._htmlEscape(e.entity_id)}</div>
            </div>
          </div>`
        ).join("")
      : `<div class="entity-item" style="cursor:default;opacity:0.5"><div class="entity-item-info"><div class="entity-item-name">No results</div></div></div>`;
  }

  _renderTimerCard(t) {
    const color = this._statusColor(t.status);
    const isRunning = t.status === "running";
    const progress = t.duration > 0 ? Math.min(1, (t.duration - t.remaining) / t.duration) : 0;
    const size = 110;
    const stroke = 8;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference * (1 - progress);
    const targetIcon = this._getEntityIcon(t.target_entity);
    const targetName = this._getEntityName(t.target_entity);
    const actionLabel = this._getActionLabel(t.target_service);

    let actionBtn;
    if (isRunning) {
      actionBtn = `<button type="button" class="btn btn-stop" data-action="stop" data-entity="${this._htmlEscape(t.entity_id)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg> Stop
      </button>`;
    } else if (t.status === "idle") {
      actionBtn = `<button type="button" class="btn btn-start" data-action="start" data-entity="${this._htmlEscape(t.entity_id)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Start
      </button>`;
    } else {
      actionBtn = `<button type="button" class="btn btn-done" disabled>
        ${t.status === "finished" ? "Finished" : "Cancelled"}
      </button>`;
    }

    return `<div class="timer-card" data-entity="${this._htmlEscape(t.entity_id)}" data-remaining="${t.remaining}" data-duration="${t.duration}" data-status="${this._htmlEscape(t.status)}" style="--card-color:${color}">
      <div class="card-header">
        <div class="card-title-row">
          <ha-icon icon="${this._htmlEscape(targetIcon)}" class="card-icon"></ha-icon>
          <div class="card-titles">
            <div class="card-name">${this._htmlEscape(t.name)}</div>
            <div class="card-target">${this._htmlEscape(actionLabel)} · ${this._htmlEscape(targetName)}</div>
          </div>
        </div>
        <div class="badge" style="background:${color}22;color:${color}">${this._statusLabel(t.status)}</div>
      </div>
      <div class="card-body">
        <div class="ring-wrap" style="--size:110px">
          <svg width="110" height="110">
            <circle cx="55" cy="55" r="${radius}" fill="none" stroke="var(--divider-color, rgba(255,255,255,0.08))" stroke-width="${stroke}"/>
            <circle cx="55" cy="55" r="${radius}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
              stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}" transform="rotate(-90 55 55)"
              style="transition:stroke-dashoffset 1s linear;filter:drop-shadow(0 0 4px ${color})"/>
          </svg>
          <div class="ring-center">
            <div class="time">${this._formatTime(t.remaining)}</div>
            ${t.duration > 0 ? `<div class="total">/ ${this._formatTime(t.duration)}</div>` : ""}
          </div>
        </div>
      </div>
      <div class="card-footer">
        ${actionBtn}
        <button type="button" class="btn-delete" data-action="delete" data-entity="${this._htmlEscape(t.entity_id)}" title="Delete" aria-label="Delete">×</button>
      </div>
    </div>`;
  }

  _statusColor(status) {
    const colors = { running: "#03a9f4", finished: "#4caf50", cancelled: "#9e9e9e", idle: "#607d8b" };
    return colors[status] || colors.idle;
  }

  _statusLabel(status) {
    const labels = { running: "Running", finished: "Finished", cancelled: "Cancelled", idle: "Idle" };
    return labels[status] || status;
  }

  _updateCountdowns() {
    if (!this._root) return;
    const cards = this._root.querySelectorAll(".timer-card");
    cards.forEach((card) => {
      const entityId = card.dataset.entity;
      const timer = this._timers.find((t) => t.entity_id === entityId);
      if (!timer) return;

      card.dataset.remaining = String(timer.remaining);
      card.dataset.duration = String(timer.duration);

      const timeEl = card.querySelector(".time");
      if (timeEl) timeEl.textContent = this._formatTime(timer.remaining);

      const totalEl = card.querySelector(".total");
      if (totalEl) totalEl.textContent = timer.duration > 0 ? `/ ${this._formatTime(timer.duration)}` : "";

      const progress = timer.duration > 0 ? Math.min(1, (timer.duration - timer.remaining) / timer.duration) : 0;
      const size = 110;
      const stroke = 8;
      const radius = (size - stroke) / 2;
      const circumference = 2 * Math.PI * radius;
      const dashOffset = circumference * (1 - progress);

      const circle = card.querySelector("circle[stroke-dasharray]");
      if (circle) circle.setAttribute("stroke-dashoffset", dashOffset);
    });
  }

  _attachFormListeners() {
    const overlay = this._shadow.getElementById("form-overlay");
    if (overlay) overlay.onclick = (e) => {
      if (e.target === overlay) this._closeForm();
    };

    const closeBtn = this._shadow.getElementById("form-close");
    if (closeBtn) closeBtn.onclick = () => this._closeForm();

    const cancelBtn = this._shadow.getElementById("btn-cancel");
    if (cancelBtn) cancelBtn.onclick = () => this._closeForm();

    const createBtn = this._shadow.getElementById("btn-create");
    if (createBtn) createBtn.onclick = () => this._submitForm();

    const nameInp = this._shadow.getElementById("inp-name");
    if (nameInp) nameInp.oninput = (e) => { this._formName = e.target.value; };

    const entitySearchInp = this._shadow.getElementById("inp-entity-search");
    if (entitySearchInp) {
      // Show results on first open
      this._renderEntityResults();
      entitySearchInp.oninput = (e) => {
        const start = e.target.selectionStart;
        const end = e.target.selectionEnd;
        this._entitySearch = e.target.value;
        this._renderEntityResults();
        e.target.focus();
        e.target.setSelectionRange(start, end);
      };
    }

    const results = this._shadow.getElementById("entity-results");
    if (results) {
      results.onclick = (e) => {
        const item = e.target.closest(".entity-item[data-entity]");
        if (!item) return;
        this._formEntity = item.dataset.entity;
        this._formAction = "turn_off";
        this._entitySearch = "";
        this._render();
      };
    }

    const clearEntityBtn = this._shadow.getElementById("btn-clear-entity");
    if (clearEntityBtn) clearEntityBtn.onclick = () => {
      this._formEntity = "";
      this._entitySearch = "";
      this._render();
    };

    const actionInp = this._shadow.getElementById("inp-action");
    if (actionInp) actionInp.onchange = (e) => { this._formAction = e.target.value; };

    const delayInp = this._shadow.getElementById("inp-delay");
    if (delayInp) {
      delayInp.oninput = (e) => { this._formDelay = e.target.value; };
      delayInp.onkeydown = (e) => { if (e.key === "Enter") e.preventDefault(); };
    }

    if (actionInp) actionInp.onkeydown = (e) => { if (e.key === "Enter") e.preventDefault(); };

    const _preventEnter = (e) => { if (e.key === "Enter") e.preventDefault(); };
    if (nameInp) nameInp.onkeydown = _preventEnter;
    if (entitySearchInp) entitySearchInp.onkeydown = _preventEnter;
  }

  _attachPanelListeners() {
    if (!this._root) return;
    const newBtn = this._root.querySelector("#btn-new");
    if (newBtn) newBtn.onclick = () => { this._openForm(); };

    this._root.querySelectorAll("[data-action]").forEach((btn) => {
      btn.onclick = () => {
        const entityId = btn.dataset.entity;
        const action = btn.dataset.action;
        if (action === "start") this._toggleTimer(entityId, false);
        else if (action === "stop") this._toggleTimer(entityId, true);
        else if (action === "delete") this._cancelTimer(entityId);
      };
    });
  }
}

customElements.define("delayed-action-panel", DelayedActionPanel);
