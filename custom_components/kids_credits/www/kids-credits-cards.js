/**
 * Kids Credits cards
 * ------------------
 * Two self-contained (no build step, no external deps) Lovelace cards for
 * the Kids Credits integration:
 *
 *   - kids-credits-parent-card : award/deduct credits, task buttons, history.
 *                                Only put this on a dashboard parents see.
 *   - kids-credits-kids-card   : read-only balance + progress display, meant
 *                                for a shared kids tablet. Never calls a
 *                                service.
 *
 * Both auto-discover every `sensor.*` entity exposed by this integration by
 * duck-typing on the `kid_id` / `reward_threshold` attributes the backend
 * always sets (see custom_components/kids_credits/sensor.py) - no entity
 * list needs to be configured by hand.
 *
 * Same `hass`-tick-suppression rule as the Life Events cards: `hass` is
 * reassigned on every state change anywhere in HA, so any card with a
 * persistent text input (the parent card's manual +/- reason field) must
 * skip re-rendering while that input has focus, or typing gets wiped
 * mid-keystroke. See PARENT_INPUT_SELECTOR / _safeRerender() below.
 */
(() => {
  console.info("Kids Credits cards: v0.0.1 loaded");

  const DOMAIN = "kids_credits";
  const PARENT_INPUT_SELECTOR = "input, textarea";

  function css(strings, ...values) {
    return strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), "");
  }

  function escapeAttr(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  async function callService(hass, service, data) {
    return hass.callService(DOMAIN, service, data);
  }

  function getKidEntities(hass) {
    if (!hass) return [];
    return Object.values(hass.states)
      .filter(
        (st) =>
          st.entity_id.startsWith("sensor.") &&
          st.attributes &&
          "kid_id" in st.attributes &&
          "reward_threshold" in st.attributes
      )
      .sort((a, b) => (a.attributes.friendly_name || "").localeCompare(b.attributes.friendly_name || ""));
  }

  function formatWhen(unixSeconds) {
    if (!unixSeconds) return "";
    const d = new Date(unixSeconds * 1000);
    return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) + " " +
      d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  }

  // --------------------------------------------------------------------
  // Task catalog - transcribed from the family's "zelfstandigheids
  // beloningen" document. Point values for the 2/3/5-credit groups and
  // the household rota (1 credit, the document's general default rule)
  // come straight from the doc. The document does NOT specify how many
  // credits to deduct for each misbehavior listed under "credits in
  // mindering" - those default to 1 and are adjustable per-click via a
  // stepper rather than silently guessing a fixed number.
  // --------------------------------------------------------------------
  const TASK_GROUPS = [
    {
      points: 5,
      label: "5 credits",
      tasks: [
        "20 minuten serieus knutselen of tekenen/kleuren (zonder tablet, zelf opruimen)",
        "20 minuten hardop voorlezen uit een boek",
        "Een puzzel maken in een oefen- of puzzelboekje",
      ],
    },
    {
      points: 3,
      label: "3 credits",
      tasks: [
        "Vuile was in de wasmand doen en in de badkamer zetten (donderdag)",
        "Bed opmaken (deze week)",
        "Kamer opruimen, ook stofzuigen, bureau en prullenbak legen",
      ],
    },
    {
      points: 2,
      label: "2 credits",
      tasks: [
        "Vaatwasser uitruimen",
        "Kleine tafel opruimen en nat afnemen",
        "Grote tafel opruimen en nat afnemen",
        "Papiermand legen in de papiercontainer (blauwe deksel)",
        "Grote zwarte prullenbak legen",
        "Wasmachine aanzetten met vuile was uit 1 wasmand (dinsdag/vrijdag)",
      ],
    },
    {
      points: 1,
      label: "1 credit (huishoudelijke taak)",
      tasks: [
        "Boodschappen doen",
        "Wassen draaien",
        "Toiletten reinigen",
        "Was opvouwen/opruimen",
        "Kattenbak schoon",
        "Huiskamer opruimen",
        "Sanitair reinigen",
        "Afvalbakken legen",
        "Stofzuigen",
        "Vegen",
      ],
    },
  ];

  const DEDUCTIONS = [
    "Iemand geschopt, geslagen of gekrabd",
    "Bord/beker/glas/bestek na de maaltijd niet opgeruimd",
    "Schoenen niet netjes op de schoenentoren gezet",
    "Dekens of kussens op de grond laten liggen",
    "Met deuren gegooid of iets kapotgemaakt uit boosheid",
  ];

  // --------------------------------------------------------------------
  // Parent card
  // --------------------------------------------------------------------
  class KidsCreditsParentCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._config = {};
      this._deductAmount = {}; // per-kid-per-reason stepper state, keyed "kidId::reason"
    }

    setConfig(config) {
      this._config = config || {};
      this._render();
    }

    set hass(hass) {
      this._hass = hass;
      this._safeRerender();
    }

    get hass() {
      return this._hass;
    }

    getCardSize() {
      return 6;
    }

    static getStubConfig() {
      return { title: "Credits toekennen" };
    }

    _safeRerender() {
      const active = this.shadowRoot && this.shadowRoot.activeElement;
      if (active && active.matches && active.matches(PARENT_INPUT_SELECTOR)) return;
      this._render();
    }

    _deductStep(kidId, reason, delta) {
      const key = `${kidId}::${reason}`;
      const current = this._deductAmount[key] || 1;
      this._deductAmount[key] = Math.max(1, Math.min(20, current + delta));
      this._render();
    }

    async _award(kidId, amount, reason) {
      const actorInput = this.shadowRoot.querySelector("#kc-actor");
      const actor = actorInput ? actorInput.value.trim() || null : null;
      await callService(this._hass, "award_points", { kid_id: kidId, amount, reason, actor });
    }

    async _deduct(kidId, amount, reason) {
      const actorInput = this.shadowRoot.querySelector("#kc-actor");
      const actor = actorInput ? actorInput.value.trim() || null : null;
      await callService(this._hass, "deduct_points", { kid_id: kidId, amount, reason, actor });
    }

    async _redeem(kidId, amount, threshold) {
      const actorInput = this.shadowRoot.querySelector("#kc-actor");
      const actor = actorInput ? actorInput.value.trim() || null : null;
      await callService(this._hass, "redeem_reward", {
        kid_id: kidId,
        amount,
        reason: `Beloning bij ${threshold} credits`,
        actor,
      });
    }

    async _manual(kidId, sign) {
      const amountInput = this.shadowRoot.querySelector(`#kc-manual-amount-${kidId}`);
      const reasonInput = this.shadowRoot.querySelector(`#kc-manual-reason-${kidId}`);
      const amount = parseInt(amountInput.value, 10);
      const reason = reasonInput.value.trim();
      if (!amount || amount <= 0 || !reason) return;
      if (sign > 0) await this._award(kidId, amount, reason);
      else await this._deduct(kidId, amount, reason);
      amountInput.value = "";
      reasonInput.value = "";
    }

    _render() {
      if (!this.shadowRoot) return;
      const hass = this._hass;
      const kids = getKidEntities(hass);
      const title = this._config.title;

      const kidsHtml = kids.length
        ? kids.map((st) => this._renderKid(st)).join("")
        : `<div class="kc-empty">Nog geen kinderen ingesteld. Voeg ze toe via Instellingen &gt; Apparaten &amp; diensten &gt; Kids Credits.</div>`;

      this.shadowRoot.innerHTML = css`
        <style>
          ha-card { padding: 16px; }
          .kc-actor-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
          .kc-actor-row label { font-size: 0.9em; color: var(--secondary-text-color); }
          .kc-actor-row input {
            flex: 1; max-width: 200px; padding: 6px 8px; border-radius: 6px;
            border: 1px solid var(--divider-color); background: var(--card-background-color);
            color: var(--primary-text-color);
          }
          .kc-kid { border-top: 1px solid var(--divider-color); padding-top: 16px; margin-top: 16px; }
          .kc-kid:first-of-type { border-top: none; margin-top: 0; padding-top: 0; }
          .kc-kid-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
          .kc-kid-header ha-icon { color: var(--primary-color); }
          .kc-kid-name { font-size: 1.15em; font-weight: 600; flex: 1; }
          .kc-balance { font-size: 1.3em; font-weight: 700; color: var(--primary-color); }
          .kc-progress-wrap { height: 8px; border-radius: 4px; background: var(--divider-color); overflow: hidden; margin-bottom: 12px; }
          .kc-progress-bar { height: 100%; background: var(--primary-color); transition: width 0.3s ease; }
          .kc-group { margin-bottom: 10px; }
          .kc-group-label { font-size: 0.85em; color: var(--secondary-text-color); margin-bottom: 4px; }
          .kc-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
          .kc-task-btn {
            border: 1px solid var(--divider-color); background: var(--card-background-color);
            color: var(--primary-text-color); border-radius: 16px; padding: 6px 12px;
            font-size: 0.85em; cursor: pointer; text-align: left;
          }
          .kc-task-btn:hover { background: var(--secondary-background-color); }
          .kc-deduct-btn {
            border: 1px solid var(--error-color, #db4437); color: var(--error-color, #db4437);
            background: var(--card-background-color); border-radius: 16px; padding: 4px 6px 4px 12px;
            font-size: 0.85em; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
          }
          .kc-deduct-btn:hover { background: rgba(219, 68, 55, 0.08); }
          .kc-stepper { display: inline-flex; align-items: center; gap: 2px; }
          .kc-stepper button {
            width: 20px; height: 20px; line-height: 1; border-radius: 50%; border: none;
            background: var(--secondary-background-color); color: var(--primary-text-color); cursor: pointer;
          }
          .kc-manual-row { display: flex; gap: 6px; align-items: center; margin: 10px 0; flex-wrap: wrap; }
          .kc-manual-row input[type="number"] { width: 60px; padding: 6px; border-radius: 6px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
          .kc-manual-row input[type="text"] { flex: 1; min-width: 140px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
          .kc-manual-row button { border-radius: 50%; width: 32px; height: 32px; border: none; font-size: 1.1em; cursor: pointer; }
          .kc-plus { background: var(--primary-color); color: var(--text-primary-color, #fff); }
          .kc-minus { background: var(--error-color, #db4437); color: #fff; }
          .kc-redeem-btn {
            margin: 8px 0; padding: 8px 16px; border-radius: 20px; border: none;
            background: var(--primary-color); color: var(--text-primary-color, #fff); cursor: pointer; font-weight: 600;
          }
          .kc-redeem-btn:disabled { opacity: 0.4; cursor: default; }
          .kc-history { margin-top: 8px; }
          .kc-history-row { font-size: 0.8em; color: var(--secondary-text-color); display: flex; justify-content: space-between; padding: 2px 0; }
          .kc-history-row .delta-pos { color: var(--success-color, #43a047); font-weight: 600; }
          .kc-history-row .delta-neg { color: var(--error-color, #db4437); font-weight: 600; }
          .kc-empty { color: var(--secondary-text-color); padding: 12px 0; }
          details summary { cursor: pointer; font-size: 0.85em; color: var(--secondary-text-color); }
        </style>
        <ha-card ${title ? `header="${escapeAttr(title)}"` : ""}>
          <div class="card-content">
            <div class="kc-actor-row">
              <label for="kc-actor">Ingevuld door</label>
              <input id="kc-actor" type="text" placeholder="papa / mama" />
            </div>
            ${kidsHtml}
          </div>
        </ha-card>
      `;

      this._bindEvents();
    }

    _renderKid(st) {
      const kidId = st.attributes.kid_id;
      const name = st.attributes.friendly_name || kidId;
      const icon = st.attributes.icon || "mdi:account-child";
      const balance = Number(st.state) || 0;
      const threshold = st.attributes.reward_threshold || 15;
      const pct = Math.max(0, Math.min(100, (balance / threshold) * 100));
      const canRedeem = balance >= threshold;
      const history = (st.attributes.history || []).slice(0, 5);

      const groupsHtml = TASK_GROUPS.map(
        (group) => css`
          <div class="kc-group">
            <div class="kc-group-label">${group.label}</div>
            <div class="kc-buttons">
              ${group.tasks
                .map(
                  (task) => css`
                    <button
                      class="kc-task-btn"
                      data-action="award"
                      data-kid="${escapeAttr(kidId)}"
                      data-amount="${group.points}"
                      data-reason="${escapeAttr(task)}"
                    >+${group.points} · ${escapeAttr(task)}</button>
                  `
                )
                .join("")}
            </div>
          </div>
        `
      ).join("");

      const deductHtml = DEDUCTIONS.map((reason) => {
        const key = `${kidId}::${reason}`;
        const amount = this._deductAmount[key] || 1;
        return css`
          <div class="kc-deduct-btn">
            <span
              data-action="deduct"
              data-kid="${escapeAttr(kidId)}"
              data-amount="${amount}"
              data-reason="${escapeAttr(reason)}"
              style="cursor:pointer;"
            >&minus;${amount} · ${escapeAttr(reason)}</span>
            <span class="kc-stepper">
              <button data-action="step-down" data-kid="${escapeAttr(kidId)}" data-reason="${escapeAttr(reason)}">&minus;</button>
              <button data-action="step-up" data-kid="${escapeAttr(kidId)}" data-reason="${escapeAttr(reason)}">+</button>
            </span>
          </div>
        `;
      }).join("");

      const historyHtml = history.length
        ? history
            .map(
              (h) => css`
                <div class="kc-history-row">
                  <span>${escapeAttr(h.reason)}</span>
                  <span class="${h.delta > 0 ? "delta-pos" : "delta-neg"}">${h.delta > 0 ? "+" : ""}${h.delta} · ${formatWhen(h.created_at)}</span>
                </div>
              `
            )
            .join("")
        : `<div class="kc-history-row"><span>Nog geen geschiedenis</span></div>`;

      return css`
        <div class="kc-kid">
          <div class="kc-kid-header">
            <ha-icon icon="${escapeAttr(icon)}"></ha-icon>
            <span class="kc-kid-name">${escapeAttr(name)}</span>
            <span class="kc-balance">${balance} credits</span>
          </div>
          <div class="kc-progress-wrap"><div class="kc-progress-bar" style="width:${pct}%"></div></div>

          ${groupsHtml}

          <div class="kc-group">
            <div class="kc-group-label">Credits in mindering</div>
            <div class="kc-buttons">${deductHtml}</div>
          </div>

          <div class="kc-manual-row">
            <input type="number" id="kc-manual-amount-${escapeAttr(kidId)}" placeholder="aantal" min="1" />
            <input type="text" id="kc-manual-reason-${escapeAttr(kidId)}" placeholder="reden" />
            <button class="kc-plus" data-action="manual-plus" data-kid="${escapeAttr(kidId)}" title="Toekennen">+</button>
            <button class="kc-minus" data-action="manual-minus" data-kid="${escapeAttr(kidId)}" title="Afnemen">&minus;</button>
          </div>

          <button
            class="kc-redeem-btn"
            data-action="redeem"
            data-kid="${escapeAttr(kidId)}"
            data-amount="${threshold}"
            data-threshold="${threshold}"
            ${canRedeem ? "" : "disabled"}
          >🎁 Beloning uitkeren (${threshold} credits)</button>

          <details class="kc-history">
            <summary>Recente geschiedenis</summary>
            ${historyHtml}
          </details>
        </div>
      `;
    }

    _bindEvents() {
      this.shadowRoot.querySelectorAll("[data-action]").forEach((el) => {
        el.addEventListener("click", async (ev) => {
          const action = el.dataset.action;
          const kidId = el.dataset.kid;
          if (action === "award") {
            await this._award(kidId, parseInt(el.dataset.amount, 10), el.dataset.reason);
          } else if (action === "deduct") {
            await this._deduct(kidId, parseInt(el.dataset.amount, 10), el.dataset.reason);
          } else if (action === "step-up") {
            this._deductStep(kidId, el.dataset.reason, 1);
          } else if (action === "step-down") {
            this._deductStep(kidId, el.dataset.reason, -1);
          } else if (action === "manual-plus") {
            await this._manual(kidId, 1);
          } else if (action === "manual-minus") {
            await this._manual(kidId, -1);
          } else if (action === "redeem") {
            await this._redeem(kidId, parseInt(el.dataset.amount, 10), el.dataset.threshold);
          }
        });
      });
    }
  }

  // --------------------------------------------------------------------
  // Kids card - strictly read-only, no service calls, meant for a shared
  // kids tablet dashboard.
  // --------------------------------------------------------------------
  class KidsCreditsKidsCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._config = {};
    }

    setConfig(config) {
      this._config = config || {};
      this._render();
    }

    set hass(hass) {
      this._hass = hass;
      this._render();
    }

    get hass() {
      return this._hass;
    }

    getCardSize() {
      return 4;
    }

    static getStubConfig() {
      return { title: "Onze credits" };
    }

    _render() {
      if (!this.shadowRoot) return;
      const hass = this._hass;
      const kids = getKidEntities(hass);
      const title = this._config.title || "Onze credits";

      const kidsHtml = kids.length
        ? css`<div class="kc-grid">${kids.map((st) => this._renderKid(st)).join("")}</div>`
        : `<div class="kc-empty">Nog geen kinderen ingesteld.</div>`;

      this.shadowRoot.innerHTML = css`
        <style>
          ha-card { padding: 20px; }
          .kc-title { font-size: 1.4em; font-weight: 700; margin-bottom: 16px; text-align: center; }
          .kc-grid { display: flex; gap: 20px; flex-wrap: wrap; justify-content: center; }
          .kc-kid-tile {
            flex: 1 1 200px; max-width: 280px; text-align: center; border-radius: 16px;
            background: var(--secondary-background-color); padding: 20px 16px;
          }
          .kc-kid-icon { --mdc-icon-size: 48px; color: var(--primary-color); }
          .kc-kid-name { font-size: 1.2em; font-weight: 700; margin: 8px 0 4px; }
          .kc-kid-balance { font-size: 2.4em; font-weight: 800; color: var(--primary-color); line-height: 1; }
          .kc-kid-unit { font-size: 0.5em; font-weight: 500; color: var(--secondary-text-color); }
          .kc-progress-wrap { height: 14px; border-radius: 7px; background: var(--divider-color); overflow: hidden; margin: 12px 0 6px; }
          .kc-progress-bar { height: 100%; border-radius: 7px; background: linear-gradient(90deg, var(--primary-color), var(--success-color, #43a047)); transition: width 0.4s ease; }
          .kc-progress-label { font-size: 0.85em; color: var(--secondary-text-color); }
          .kc-reward-ready { font-size: 0.95em; font-weight: 700; color: var(--success-color, #43a047); margin-top: 6px; }
          .kc-empty { color: var(--secondary-text-color); text-align: center; padding: 20px 0; }
        </style>
        <ha-card>
          <div class="card-content">
            <div class="kc-title">${escapeAttr(title)}</div>
            ${kidsHtml}
          </div>
        </ha-card>
      `;
    }

    _renderKid(st) {
      const name = st.attributes.friendly_name || st.attributes.kid_id;
      const icon = st.attributes.icon || "mdi:account-child";
      const balance = Number(st.state) || 0;
      const threshold = st.attributes.reward_threshold || 15;
      const pct = Math.max(0, Math.min(100, (balance / threshold) * 100));
      const ready = balance >= threshold;

      return css`
        <div class="kc-kid-tile">
          <ha-icon class="kc-kid-icon" icon="${escapeAttr(icon)}"></ha-icon>
          <div class="kc-kid-name">${escapeAttr(name)}</div>
          <div class="kc-kid-balance">${balance}<span class="kc-kid-unit"> credits</span></div>
          <div class="kc-progress-wrap"><div class="kc-progress-bar" style="width:${pct}%"></div></div>
          <div class="kc-progress-label">${ready ? "Beloning verdiend! 🎉" : `nog ${threshold - balance} tot een beloning`}</div>
        </div>
      `;
    }
  }

  customElements.define("kids-credits-parent-card", KidsCreditsParentCard);
  customElements.define("kids-credits-kids-card", KidsCreditsKidsCard);

  window.customCards = window.customCards || [];
  window.customCards.push(
    {
      type: "kids-credits-parent-card",
      name: "Kids Credits - Ouders",
      description: "Ken credits toe of neem ze af, met knoppen per taak.",
    },
    {
      type: "kids-credits-kids-card",
      name: "Kids Credits - Kinderen",
      description: "Alleen-lezen overzicht van de credits per kind, voor een gedeeld dashboard.",
    }
  );
})();
