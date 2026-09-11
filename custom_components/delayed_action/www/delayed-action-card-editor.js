/**
 * Delayed Action Card Editor — Native Web Components
 * No external dependencies. Zero external imports.
 */
class DelayedActionCardEditor extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._config = { name: "", compact: false };
    this._nameDebounce = null;
    this._lastEntitiesKey = "";
    this._shadow = this.attachShadow({ mode: "open" });
    this._renderStyles();
  }

  setConfig(config) {
    this._config = { name: "", compact: false, ...config };
    this._lastEntitiesKey = "";
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const newKey = this._getEntities().join(",");
    if (newKey === this._lastEntitiesKey) return;
    this._lastEntitiesKey = newKey;
    this._render();
  }

  _getEntities() {
    if (!this._hass) return [];
    return Object.keys(this._hass.states)
      .filter((id) => id.startsWith("delayed_action."))
      .sort();
  }

  _fireEvent(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  _valueChanged(key, value) {
    const newConfig = { ...this._config };
    if (value === "" || value === null) {
      delete newConfig[key];
    } else {
      newConfig[key] = value;
    }
    this._config = newConfig;
    this._fireEvent("config-changed", { config: newConfig });
  }

  _htmlEscape(str) {
    if (str == null) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  _renderStyles() {
    this._shadow.innerHTML = `<style>
      :host { display: block; font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
      .form { display: flex; flex-direction: column; gap: 16px; padding: 16px; color: var(--primary-text-color, #fff); }
      .field { display: flex; flex-direction: column; gap: 6px; }
      .field label { font-size: 13px; font-weight: 600; color: var(--secondary-text-color, #aaa); }
      .field select, .field input { background: var(--card-background-color, #1e1e1e); color: var(--primary-text-color, #fff); border: 1px solid var(--divider-color, rgba(255,255,255,0.1)); border-radius: 8px; padding: 10px 12px; font-size: 14px; }
      .switch-row { display: flex; align-items: center; gap: 12px; }
      .switch { position: relative; width: 44px; height: 24px; }
      .switch input { opacity: 0; width: 0; height: 0; }
      .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: #9e9e9e; border-radius: 24px; transition: 0.3s; }
      .slider:before { content: ""; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: 0.3s; }
      input:checked + .slider { background: #03a9f4; }
      input:checked + .slider:before { transform: translateX(20px); }
    </style><div id="root"></div>`;
    this._root = this._shadow.getElementById("root");
  }

  _render() {
    if (!this._root) return;
    const entities = this._getEntities();
    const entityOptions = entities.map((id) =>
      `<option value="${this._htmlEscape(id)}" ${id === this._config.entity ? "selected" : ""}>${this._htmlEscape(id)}</option>`
    ).join("");

    this._root.innerHTML = `<div class="form">
      <div class="field">
        <label for="inp-entity">Entity</label>
        <select id="inp-entity">
          <option value="">Select...</option>
          ${entityOptions}
        </select>
      </div>
      <div class="field">
        <label for="inp-name">Display name (optional)</label>
        <input id="inp-name" type="text" placeholder="Target entity name is used" value="${this._htmlEscape(this._config.name || "")}">
      </div>
      <div class="field">
        <label>Compact mode</label>
        <div class="switch-row">
          <label class="switch">
            <input type="checkbox" id="inp-compact" ${this._config.compact ? "checked" : ""}>
            <span class="slider"></span>
          </label>
        </div>
      </div>
    </div>`;

    const entitySel = this._shadow.getElementById("inp-entity");
    if (entitySel) entitySel.onchange = (e) => this._valueChanged("entity", e.target.value);

    const nameInp = this._shadow.getElementById("inp-name");
    if (nameInp) {
      nameInp.oninput = (e) => {
        if (this._nameDebounce) clearTimeout(this._nameDebounce);
        const value = e.target.value;
        this._nameDebounce = setTimeout(() => {
          this._valueChanged("name", value);
        }, 300);
      };
      nameInp.onchange = (e) => {
        if (this._nameDebounce) {
          clearTimeout(this._nameDebounce);
          this._nameDebounce = null;
        }
        this._valueChanged("name", e.target.value);
      };
    }

    const compactInp = this._shadow.getElementById("inp-compact");
    if (compactInp) compactInp.onchange = (e) => this._valueChanged("compact", e.target.checked);

    this._lastEntitiesKey = this._getEntities().join(",");
  }
}

customElements.define("delayed-action-card-editor", DelayedActionCardEditor);
