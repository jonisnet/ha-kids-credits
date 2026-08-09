/**
 * Kids Credits cards
 * ------------------
 * Four card types (two "real" cards, two matching visual editors) for the
 * Kids Credits integration, no build step / no external deps:
 *
 *   - kids-credits-parent-card : ONE kid, ONE parent per card instance
 *     (config: kid_id, actor). Put 2 kids x 2 parents = 4 instances on
 *     separate parent-only dashboards/views. Task/deduction/reward lists
 *     open in a popup per credit-tier and are editable via the card's own
 *     visual editor.
 *   - kids-credits-kids-card   : read-only for balances/history, `kids:
 *     [id, ...]` picks which kid(s) show on it (empty = all). Its one
 *     exception to "never changes a balance" is `request_credit` - a kid
 *     can ask for credit for a task, which only ever creates a PENDING
 *     request; nothing about a kid's balance moves until a parent approves
 *     it from their own parent-card. Meant for a shared kids tablet.
 *
 * Both auto-discover kid sensors by duck-typing on the `kid_id` /
 * `reward_threshold` attributes this integration's sensor.py always sets.
 *
 * hass-tick suppression: `hass` is reassigned on EVERY state change
 * anywhere in HA. A full re-render while a popup is open would yank it
 * out from under the user, and while an input has focus would wipe
 * mid-keystroke typing - `_safeRerender()` on every stateful element here
 * guards both by checking the live DOM before touching innerHTML.
 */
(() => {
  console.info("Kids Credits cards loaded");

  const DOMAIN = "kids_credits";
  const FOCUSABLE_INPUT_SELECTOR = "input, textarea, select";

  function css(strings, ...values) {
    return strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), "");
  }

  function escapeAttr(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  async function callService(hass, service, data) {
    return hass.callService(DOMAIN, service, data);
  }

  // Coalesces bursts of hass ticks (very common - many entities can update
  // within the same second) into one render per animation frame instead of
  // one full DOM teardown-and-rebuild per tick. Without this, a real-world
  // tap can land between touchstart and click while the target button is
  // mid-replacement from an unrelated re-render, silently dropping the tap -
  // most noticeable right after an award, since that itself triggers a tick.
  function scheduleRerender(self, doRerender) {
    if (self.__rerenderScheduled) return;
    self.__rerenderScheduled = true;
    requestAnimationFrame(() => {
      self.__rerenderScheduled = false;
      doRerender();
    });
  }

  function getKidEntities(hass) {
    if (!hass) return [];
    return Object.values(hass.states)
      .filter(
        (st) =>
          st.entity_id.startsWith(`${DOMAIN}.`) &&
          st.attributes &&
          "kid_id" in st.attributes &&
          "reward_threshold" in st.attributes
      )
      .sort((a, b) => (a.attributes.friendly_name || "").localeCompare(b.attributes.friendly_name || ""));
  }

  function getKidEntity(hass, kidId) {
    return getKidEntities(hass).find((st) => st.attributes.kid_id === kidId);
  }

  function getNotifyServices(hass) {
    return Object.keys((hass && hass.services && hass.services.notify) || {}).sort();
  }

  // Every push notification this integration sends should open straight to
  // the credits dashboard, not just the HA app's default landing page. A
  // relative path (not the full https://... URL) is what the Companion App
  // actually navigates to in-app - a full external URL gets treated as an
  // outside link instead.
  const DASHBOARD_URL = "/sub-dash/credits-card";

  async function notifyAll(hass, notifyServiceIds, title, message) {
    if (!notifyServiceIds || !notifyServiceIds.length) return;
    for (const fullServiceId of notifyServiceIds) {
      const [notifyDomain, notifyService] = fullServiceId.split(".");
      try {
        await hass.callService(notifyDomain, notifyService, { title, message, data: { clickAction: DASHBOARD_URL } });
      } catch (err) {
        console.warn("Kids Credits: notify service call failed", fullServiceId, err);
      }
    }
  }

  // Shared by both cards - a bar that keeps extending as the goal grows
  // (rewards no longer have to top out at 15), with a tick + count at every
  // 15-credit boundary so a bigger goal (e.g. 60) still reads at a glance.
  function renderProgressBar(balance, threshold) {
    // The configured reward_threshold is a floor, not a hard ceiling - once
    // balance actually grows past it (still on the default 15, or past a
    // custom goal), the bar extends to the next 15-credit mark instead of
    // just sitting maxed out at 100% while real progress keeps happening.
    const nextFifteen = Math.max(15, Math.ceil(balance / 15) * 15);
    const goal = Math.max(threshold, nextFifteen, 1);
    const pct = Math.max(0, Math.min(100, (balance / goal) * 100));
    let ticksHtml = "";
    for (let t = 15; t < goal; t += 15) {
      const pos = (t / goal) * 100;
      ticksHtml += css`<div class="kc-progress-tick" style="left:${pos}%"><span>${t / 15}</span></div>`;
    }
    return css`
      <div class="kc-progress-wrap">
        <div class="kc-progress-bar" style="width:${pct}%"></div>
        ${ticksHtml}
      </div>
    `;
  }

  function formatWhen(unixSeconds) {
    if (!unixSeconds) return "";
    const d = new Date(unixSeconds * 1000);
    return (
      d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) +
      " " +
      d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })
    );
  }

  // Phone-camera photos are commonly several MB - never upload the raw
  // file. Center-crops to a square (matches the circular avatar) and
  // downsizes to a small JPEG, so the resulting data: URI is reliably well
  // under the backend's MAX_PHOTO_DATA_URI_LENGTH regardless of the
  // original photo's resolution.
  function processPhotoFile(file, targetSize = 320, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("kon het bestand niet lezen"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("kon de afbeelding niet laden"));
        img.onload = () => {
          const side = Math.min(img.naturalWidth, img.naturalHeight);
          const sx = (img.naturalWidth - side) / 2;
          const sy = (img.naturalHeight - side) / 2;
          const canvas = document.createElement("canvas");
          canvas.width = targetSize;
          canvas.height = targetSize;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, sx, sy, side, side, 0, 0, targetSize, targetSize);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Photo upload lives only in the card editor (Settings-gated), never on
  // the live dashboard card - a kid tapping around the actual card can't
  // accidentally trigger or change it. Resolves true if a photo was saved.
  function promptPhotoUpload(hass, kidId) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        if (!file) {
          resolve(false);
          return;
        }
        let photo;
        try {
          photo = await processPhotoFile(file);
        } catch (err) {
          alert("Foto verwerken is niet gelukt: " + err.message);
          resolve(false);
          return;
        }
        if (photo.length > 380000) {
          // Should be unreachable at 240x240 JPEG - a safety net, not the primary check.
          alert("Deze foto kon niet klein genoeg gemaakt worden, probeer een andere.");
          resolve(false);
          return;
        }
        await callService(hass, "set_kid_photo", { kid_id: kidId, photo });
        resolve(true);
      });
      input.click();
    });
  }

  function renderAvatar(st, cssClass) {
    const photo = st.attributes.photo;
    const icon = st.attributes.icon || "mdi:account-child";
    if (photo) return `<img class="${cssClass}" src="${escapeAttr(photo)}" alt="" />`;
    return `<ha-icon class="${cssClass}" icon="${escapeAttr(icon)}"></ha-icon>`;
  }

  function statusBadge(status) {
    if (status === "approved") return `<span class="kc-badge kc-badge-approved">✅ goedgekeurd</span>`;
    if (status === "rejected") return `<span class="kc-badge kc-badge-rejected">❌ afgewezen</span>`;
    return `<span class="kc-badge kc-badge-pending">⏳ in afwachting</span>`;
  }

  const REQUEST_STYLE = css`
    .kc-badge { font-size: 0.75em; font-weight: 600; padding: 2px 8px; border-radius: 10px; white-space: nowrap; }
    .kc-badge-pending { background: rgba(255, 167, 38, 0.18); color: #c47700; }
    .kc-badge-approved { background: rgba(67, 160, 71, 0.18); color: var(--success-color, #43a047); }
    .kc-badge-rejected { background: rgba(219, 68, 55, 0.18); color: var(--error-color, #db4437); }
    .kc-request-row { padding: 8px 0; border-bottom: 1px solid var(--divider-color); }
    .kc-request-row:last-child { border-bottom: none; }
    .kc-request-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .kc-request-reason { font-size: 0.95em; }
    .kc-request-meta { font-size: 0.8em; color: var(--secondary-text-color); margin-top: 2px; }
    .kc-request-actions { display: flex; gap: 8px; align-items: center; margin-top: 6px; }
    .kc-request-actions input[type="number"] {
      width: 64px; padding: 6px; border-radius: 6px; border: 1px solid var(--divider-color);
      background: var(--card-background-color); color: var(--primary-text-color);
    }
    .kc-approve-btn, .kc-reject-btn {
      border: none; border-radius: 14px; padding: 6px 12px; font-size: 0.85em; cursor: pointer;
    }
    .kc-approve-btn { background: var(--success-color, #43a047); color: #fff; }
    .kc-reject-btn { background: var(--secondary-background-color); color: var(--primary-text-color); }
    .kc-request-group-label { font-size: 0.8em; font-weight: 700; color: var(--secondary-text-color); margin: 12px 0 2px; text-transform: uppercase; letter-spacing: 0.02em; }
    .kc-request-group-label:first-child { margin-top: 0; }
    .kc-icon-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 140px)); justify-content: center; gap: 12px;
      margin-bottom: 16px;
    }
    .kc-icon-tile {
      aspect-ratio: 1; border: none; border-radius: 20px; background: var(--secondary-background-color);
      cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 4px; padding: 6px; transition: transform 0.1s ease, background 0.1s ease;
    }
    .kc-icon-tile:hover, .kc-icon-tile:active { background: var(--primary-color); }
    @media (prefers-reduced-motion: no-preference) {
      .kc-icon-tile:active { transform: scale(0.92); }
    }
    .kc-icon-tile-emoji { font-size: 2.1em; line-height: 1; }
    .kc-icon-tile-caption { font-size: 0.72em; line-height: 1.15; text-align: center; color: var(--primary-text-color); }
    .kc-request-form textarea {
      width: 100%; min-height: 70px; padding: 8px; border-radius: 8px; border: 1px solid var(--divider-color);
      background: var(--card-background-color); color: var(--primary-text-color); font-family: inherit; resize: vertical;
      box-sizing: border-box;
    }
    .kc-request-submit {
      margin-top: 10px; background: var(--primary-color); color: var(--text-primary-color, #fff);
      border: none; border-radius: 16px; padding: 8px 16px; cursor: pointer; font-weight: 600;
    }
  `;

  // --------------------------------------------------------------------
  // Default task catalog - transcribed from the family's "zelfstandigheids
  // beloningen" document. Used whenever a card's own config doesn't define
  // `groups` / `deductions` / `rewards` yet, so a freshly added card works
  // out of the box; editing them via the visual editor overrides just that
  // one card's config, it does not change the shared default.
  //
  // The document does NOT specify how many credits to deduct for each
  // misbehavior - those default to 1 and get a stepper in the popup so the
  // amount is adjustable per click rather than silently guessed.
  // --------------------------------------------------------------------
  // Each task is { icon, short, label }. `icon` is a plain emoji, `short` is
  // the caption shown under it on the kids card's icon tiles (kept short on
  // purpose - the full `label` only shows in the confirm step after tapping,
  // and is what's actually sent as the request's reason / used everywhere
  // else). normalizeTask() below accepts a legacy string or a {icon,label}
  // object missing `short`, so older card configs still work.
  const DEFAULT_GROUPS = [
    {
      points: 5,
      label: "5 credits",
      tasks: [
        { icon: "🎨", short: "Knutselen", label: "20 minuten serieus knutselen of tekenen/kleuren (zonder tablet, zelf opruimen)" },
        { icon: "📖", short: "Voorlezen", label: "20 minuten hardop voorlezen uit een boek" },
        { icon: "🧩", short: "Puzzelen", label: "Een puzzel maken in een oefen- of puzzelboekje" },
      ],
    },
    {
      points: 3,
      label: "3 credits",
      tasks: [
        { icon: "👕", short: "Was wegbrengen", label: "Vuile was in de wasmand doen en in de badkamer zetten (donderdag)" },
        { icon: "🛏️", short: "Bed opmaken", label: "Bed opmaken (deze week)" },
        { icon: "🧹", short: "Kamer opruimen", label: "Kamer opruimen, ook stofzuigen, bureau en prullenbak legen" },
      ],
    },
    {
      points: 2,
      label: "2 credits",
      tasks: [
        { icon: "🍽️", short: "Vaatwasser", label: "Vaatwasser uitruimen" },
        { icon: "🧽", short: "Kleine tafel", label: "Kleine tafel opruimen en nat afnemen" },
        { icon: "🪑", short: "Grote tafel", label: "Grote tafel opruimen en nat afnemen" },
        { icon: "📄", short: "Papier legen", label: "Papiermand legen in de papiercontainer (blauwe deksel)" },
        { icon: "🗑️", short: "Prullenbak", label: "Grote zwarte prullenbak legen" },
        { icon: "🧺", short: "Was draaien", label: "Wasmachine aanzetten met vuile was uit 1 wasmand (dinsdag/vrijdag)" },
      ],
    },
    {
      points: 1,
      label: "1 credit (huishoudelijke taak)",
      tasks: [
        { icon: "🛒", short: "Boodschappen", label: "Boodschappen doen" },
        { icon: "🌀", short: "Wasje draaien", label: "Wassen draaien" },
        { icon: "🚽", short: "Toilet poetsen", label: "Toiletten reinigen" },
        { icon: "👚", short: "Was opvouwen", label: "Was opvouwen/opruimen" },
        { icon: "🐱", short: "Kattenbak", label: "Kattenbak schoon" },
        { icon: "🛋️", short: "Huiskamer", label: "Huiskamer opruimen" },
        { icon: "🚿", short: "Sanitair", label: "Sanitair reinigen" },
        { icon: "🗑️", short: "Afval legen", label: "Afvalbakken legen" },
        { icon: "🌪️", short: "Stofzuigen", label: "Stofzuigen" },
        { icon: "🧹", short: "Vegen", label: "Vegen" },
      ],
    },
  ];

  function normalizeTask(task) {
    if (typeof task === "string") return { icon: "⭐", short: task, label: task };
    if (!task.short) return { ...task, short: task.label };
    return task;
  }

  const DEFAULT_DEDUCTIONS = [
    "Iemand geschopt, geslagen of gekrabd",
    "Bord/beker/glas/bestek na de maaltijd niet opgeruimd",
    "Schoenen niet netjes op de schoenentoren gezet",
    "Dekens of kussens op de grond laten liggen",
    "Met deuren gegooid of iets kapotgemaakt uit boosheid",
  ];

  function configGroups(config) {
    return config.groups && config.groups.length ? config.groups : DEFAULT_GROUPS;
  }
  function configDeductions(config) {
    return config.deductions && config.deductions.length ? config.deductions : DEFAULT_DEDUCTIONS;
  }
  function configRewards(config, kidState) {
    if (config.rewards && config.rewards.length) return config.rewards;
    const threshold = (kidState && kidState.attributes.reward_threshold) || 15;
    return [{ label: `Beloning bij ${threshold} credits`, cost: threshold }];
  }

  // --------------------------------------------------------------------
  // Shared modal helper. Appends a backdrop as a DOM sibling (not part of
  // the innerHTML template), so callers must guard their own _render()
  // against wiping it - see FOCUSABLE_INPUT_SELECTOR / modal-open checks
  // in each card's _safeRerender().
  // --------------------------------------------------------------------
  function showModal(shadowRoot, titleText, bodyHtml, { fullscreen = false, bigClose = false } = {}) {
    hideModal(shadowRoot);
    const backdrop = document.createElement("div");
    backdrop.className = "kc-modal-backdrop" + (fullscreen ? " kc-modal-backdrop-fullscreen" : "");
    backdrop.innerHTML = css`
      <div class="kc-modal ${fullscreen ? "kc-modal-fullscreen" : ""}">
        <div class="kc-modal-header">
          <span>${escapeAttr(titleText)}</span>
          <button class="kc-modal-close ${bigClose ? "kc-modal-close-big" : ""}" data-action="close-modal">&times;</button>
        </div>
        <div class="kc-modal-body">${bodyHtml}</div>
      </div>
    `;
    backdrop.addEventListener("click", (ev) => {
      if (ev.target === backdrop) hideModal(shadowRoot);
    });
    backdrop.querySelector(".kc-modal-close").addEventListener("click", () => hideModal(shadowRoot));
    shadowRoot.appendChild(backdrop);
    return backdrop;
  }

  function hideModal(shadowRoot) {
    const existing = shadowRoot.querySelector(".kc-modal-backdrop");
    if (existing) existing.remove();
  }

  const MODAL_STYLE = css`
    .kc-modal-backdrop {
      position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; padding: 16px; box-sizing: border-box;
    }
    .kc-modal {
      background: var(--card-background-color); color: var(--primary-text-color);
      border-radius: 12px; max-width: 480px; width: 100%; max-height: 85vh;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    }
    .kc-modal-backdrop-fullscreen { padding: 0; }
    .kc-modal-fullscreen {
      max-width: none; width: 100%; height: 100%; max-height: none; border-radius: 0;
    }
    .kc-modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px; font-weight: 600; border-bottom: 1px solid var(--divider-color);
    }
    .kc-modal-close {
      background: none; border: none; font-size: 1.4em; line-height: 1; cursor: pointer;
      color: var(--secondary-text-color); padding: 0 4px;
    }
    .kc-modal-close-big {
      font-size: 2em; width: 44px; height: 44px; border-radius: 50%;
      background: var(--secondary-background-color); display: flex; align-items: center; justify-content: center;
    }
    .kc-modal-body { padding: 12px 16px; overflow-y: auto; }
  `;

  // --------------------------------------------------------------------
  // Parent card - one kid, one parent (actor), per instance.
  // --------------------------------------------------------------------
  class KidsCreditsParentCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._config = {};
      this._deductAmount = {}; // per-reason stepper state, keyed by reason text
      // Manual amount/reason survive re-renders (see _doSafeRerender's
      // focus guard for why this matters).
      this._manualAmount = "";
      this._manualReason = "";
    }

    setConfig(config) {
      // A missing kid_id (e.g. right after adding the card, before the
      // editor's kid picker has a value yet) is handled by _render()
      // itself, not here.
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
      return 4;
    }

    static getStubConfig(hass) {
      const kid = getKidEntities(hass)[0];
      return { kid_id: kid ? kid.attributes.kid_id : "", actor: "papa" };
    }

    static getConfigElement() {
      return document.createElement("kids-credits-parent-card-editor");
    }

    _safeRerender() {
      scheduleRerender(this, () => this._doSafeRerender());
    }

    _doSafeRerender() {
      if (!this.shadowRoot) return;
      if (this.shadowRoot.querySelector(".kc-modal-backdrop")) return;
      const active = this.shadowRoot.activeElement;
      if (active && active.matches && active.matches(FOCUSABLE_INPUT_SELECTOR)) return;
      this._render();
    }

    async _award(kidId, amount, reason) {
      await callService(this._hass, "award_points", { kid_id: kidId, amount, reason, actor: this._config.actor || null });
    }

    async _deduct(kidId, amount, reason) {
      await callService(this._hass, "deduct_points", { kid_id: kidId, amount, reason, actor: this._config.actor || null });
    }

    async _redeem(kidId, reward) {
      await callService(this._hass, "redeem_reward", {
        kid_id: kidId,
        amount: reward.cost,
        reason: reward.label,
        actor: this._config.actor || null,
      });
      if (this._config.notify_service) {
        const [notifyDomain, notifyService] = this._config.notify_service.split(".");
        const kidName = (getKidEntity(this._hass, kidId) || {}).attributes?.friendly_name || kidId;
        try {
          await this._hass.callService(notifyDomain, notifyService, {
            title: "Kids Credits",
            message: `🎉 ${kidName} heeft "${reward.label}" verdiend!`,
            data: { clickAction: DASHBOARD_URL },
          });
        } catch (err) {
          console.warn("Kids Credits: notify service call failed", err);
        }
      }
    }

    async _manual(kidId, sign) {
      const amountInput = this.shadowRoot.querySelector("#kc-manual-amount");
      const reasonInput = this.shadowRoot.querySelector("#kc-manual-reason");
      const amount = parseInt(amountInput.value, 10);
      const reason = reasonInput.value.trim();
      if (!amount || amount <= 0 || !reason) return;
      if (sign > 0) await this._award(kidId, amount, reason);
      else await this._deduct(kidId, amount, reason);
      amountInput.value = "";
      reasonInput.value = "";
      this._manualAmount = "";
      this._manualReason = "";
      // Without this, the input that was just typed into keeps DOM focus,
      // and _safeRerender()'s "don't wipe in-progress typing" guard then
      // also blocks the re-render that should show OUR OWN successful
      // award/deduct - the card looks frozen until focus moves elsewhere.
      amountInput.blur();
      reasonInput.blur();
      this._safeRerender();
    }

    _openGroupModal(kidId, group) {
      const body = group.tasks
        .map(normalizeTask)
        .map(
          (task) => css`
            <button class="kc-modal-list-btn" data-action="award-modal" data-amount="${group.points}" data-reason="${escapeAttr(task.label)}">
              <span class="kc-modal-list-amount">+${group.points}</span>
              <span class="kc-modal-list-icon">${escapeAttr(task.icon)}</span>
              <span>${escapeAttr(task.label)}</span>
            </button>
          `
        )
        .join("");
      const modal = showModal(this.shadowRoot, group.label, body || `<div class="kc-empty">Geen taken ingesteld</div>`);
      modal.querySelectorAll('[data-action="award-modal"]').forEach((btn) => {
        btn.addEventListener("click", async () => {
          await this._award(kidId, parseInt(btn.dataset.amount, 10), btn.dataset.reason);
          hideModal(this.shadowRoot);
        });
      });
    }

    _openDeductionsModal(kidId) {
      this._renderDeductionsModalBody(kidId);
    }

    _renderDeductionsModalBody(kidId) {
      const deductions = configDeductions(this._config);
      const body = deductions.length
        ? deductions
            .map((reason) => {
              const amount = this._deductAmount[reason] || 1;
              return css`
                <div class="kc-modal-deduct-row">
                  <button class="kc-modal-list-btn kc-modal-deduct-apply" data-action="deduct-modal" data-reason="${escapeAttr(reason)}">
                    <span class="kc-modal-list-amount kc-deduct-amount">&minus;${amount}</span>
                    <span>${escapeAttr(reason)}</span>
                  </button>
                  <span class="kc-stepper">
                    <button data-action="deduct-step-down" data-reason="${escapeAttr(reason)}">&minus;</button>
                    <button data-action="deduct-step-up" data-reason="${escapeAttr(reason)}">+</button>
                  </span>
                </div>
              `;
            })
            .join("")
        : `<div class="kc-empty">Geen redenen ingesteld</div>`;

      const modal = showModal(this.shadowRoot, "Credits in mindering", body);
      modal.querySelectorAll('[data-action="deduct-modal"]').forEach((btn) => {
        btn.addEventListener("click", async () => {
          const reason = btn.dataset.reason;
          const amount = this._deductAmount[reason] || 1;
          await this._deduct(kidId, amount, reason);
          hideModal(this.shadowRoot);
        });
      });
      modal.querySelectorAll('[data-action="deduct-step-up"], [data-action="deduct-step-down"]').forEach((btn) => {
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const reason = btn.dataset.reason;
          const delta = btn.dataset.action === "deduct-step-up" ? 1 : -1;
          const current = this._deductAmount[reason] || 1;
          this._deductAmount[reason] = Math.max(1, Math.min(20, current + delta));
          this._renderDeductionsModalBody(kidId);
        });
      });
    }

    _openRewardsModal(kidId, st) {
      const rewards = configRewards(this._config, st);
      const balance = Number(st.state) || 0;
      const body = rewards
        .map((reward) => {
          const disabled = balance < reward.cost;
          return css`
            <button
              class="kc-modal-list-btn kc-modal-reward-btn"
              data-action="redeem-modal"
              data-cost="${reward.cost}"
              data-label="${escapeAttr(reward.label)}"
              ${disabled ? "disabled" : ""}
            >
              <span class="kc-modal-list-amount">${reward.cost}</span>
              <span>${escapeAttr(reward.label)}</span>
            </button>
          `;
        })
        .join("");
      const modal = showModal(this.shadowRoot, "🎁 Beloning uitkeren", body || `<div class="kc-empty">Geen beloningen ingesteld</div>`);
      modal.querySelectorAll('[data-action="redeem-modal"]').forEach((btn) => {
        btn.addEventListener("click", async () => {
          await this._redeem(kidId, { label: btn.dataset.label, cost: parseInt(btn.dataset.cost, 10) });
          hideModal(this.shadowRoot);
        });
      });
    }

    _openHistoryModal(st) {
      const history = st.attributes.history || [];
      const body = history.length
        ? history
            .map(
              (h) => css`
                <div class="kc-history-row-full">
                  <div class="kc-history-reason">${escapeAttr(h.reason)}</div>
                  <div class="kc-history-meta">
                    <span class="${h.delta > 0 ? "delta-pos" : "delta-neg"}">${h.delta > 0 ? "+" : ""}${h.delta}</span>
                    <span>${formatWhen(h.created_at)}</span>
                    <span>${h.actor ? "door " + escapeAttr(h.actor) : ""}</span>
                  </div>
                </div>
              `
            )
            .join("")
        : `<div class="kc-empty">Nog geen geschiedenis</div>`;
      showModal(this.shadowRoot, `Geschiedenis van ${escapeAttr(st.attributes.friendly_name || "")}`, body);
    }

    _openRequestsModal(kidId, st) {
      this._renderRequestsModalBody(kidId, st);
    }

    _renderRequestsModalBody(kidId, st) {
      const pending = (st.attributes.requests || []).filter((r) => r.status === "pending");
      const body = pending.length
        ? pending
            .map(
              (r) => css`
                <div class="kc-request-row">
                  <div class="kc-request-reason">${r.kind === "reward" ? "🎁" : "✋"} ${escapeAttr(r.reason)}</div>
                  <div class="kc-request-meta">${formatWhen(r.created_at)}</div>
                  <div class="kc-request-actions">
                    <input
                      type="number"
                      min="1"
                      placeholder="credits"
                      id="kc-req-amount-${escapeAttr(r.id)}"
                      ${r.suggested_amount ? `value="${r.suggested_amount}"` : ""}
                    />
                    <button class="kc-approve-btn" data-action="approve-request" data-request="${escapeAttr(r.id)}">Goedkeuren</button>
                    <button class="kc-reject-btn" data-action="reject-request" data-request="${escapeAttr(r.id)}">Afwijzen</button>
                  </div>
                </div>
              `
            )
            .join("")
        : `<div class="kc-empty">Geen openstaande verzoeken</div>`;

      const modal = showModal(this.shadowRoot, "Openstaande verzoeken", body);
      modal.querySelectorAll('[data-action="approve-request"]').forEach((btn) => {
        btn.addEventListener("click", async () => {
          const requestId = btn.dataset.request;
          const amountInput = modal.querySelector(`#kc-req-amount-${CSS.escape(requestId)}`);
          const amount = parseInt(amountInput.value, 10);
          if (!amount || amount <= 0) {
            amountInput.focus();
            return;
          }
          await callService(this._hass, "approve_request", {
            request_id: requestId,
            amount,
            actor: this._config.actor || null,
          });
          this._renderRequestsModalBody(kidId, getKidEntity(this._hass, kidId) || st);
        });
      });
      modal.querySelectorAll('[data-action="reject-request"]').forEach((btn) => {
        btn.addEventListener("click", async () => {
          await callService(this._hass, "reject_request", {
            request_id: btn.dataset.request,
            actor: this._config.actor || null,
          });
          this._renderRequestsModalBody(kidId, getKidEntity(this._hass, kidId) || st);
        });
      });
    }

    _render() {
      if (!this.shadowRoot) return;
      const hass = this._hass;
      const kidId = this._config.kid_id;
      const st = kidId ? getKidEntity(hass, kidId) : null;
      const title = this._config.title;

      if (!st) {
        this.shadowRoot.innerHTML = css`
          <ha-card ${title ? `header="${escapeAttr(title)}"` : ""}>
            <div class="card-content">
              <div class="kc-empty">
                ${kidId
                  ? `Geen kind gevonden met id "${escapeAttr(kidId)}". Is Kids Credits ingesteld?`
                  : "Kies een kind via de kaart-editor."}
              </div>
            </div>
          </ha-card>
          <style>.kc-empty { color: var(--secondary-text-color); padding: 12px 0; }</style>
        `;
        return;
      }

      const name = st.attributes.friendly_name || kidId;
      const balance = Number(st.state) || 0;
      const threshold = st.attributes.reward_threshold || 15;
      const groups = configGroups(this._config);
      const deductions = configDeductions(this._config);
      const rewards = configRewards(this._config, st);
      const canRedeemAny = rewards.some((r) => balance >= r.cost);
      const pendingCount = (st.attributes.requests || []).filter((r) => r.status === "pending").length;

      const chipsHtml = groups
        .map(
          (group) => css`
            <button class="kc-chip" data-action="open-group" data-points="${group.points}">
              +${group.points} · ${escapeAttr(group.label)} <span class="kc-chip-count">${group.tasks.length}</span>
            </button>
          `
        )
        .join("");

      this.shadowRoot.innerHTML = css`
        <style>
          ${MODAL_STYLE}
          ${REQUEST_STYLE}
          :host { display: block; }
          ha-card { padding: 16px; }
          .kc-header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
          .kc-avatar-wrap { position: relative; flex-shrink: 0; }
          .kc-avatar { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; --mdc-icon-size: 48px; color: var(--primary-color); cursor: pointer; }
          img.kc-avatar { background: var(--secondary-background-color); }
          .kc-name-actor { flex: 1; min-width: 0; }
          .kc-name { font-size: 1.15em; font-weight: 700; cursor: pointer; }
          .kc-name:hover { text-decoration: underline; }
          .kc-actor { font-size: 0.8em; color: var(--secondary-text-color); }
          .kc-balance { font-size: 1.3em; font-weight: 700; color: var(--primary-color); white-space: nowrap; }
          .kc-progress-wrap { position: relative; height: 8px; border-radius: 4px; background: var(--divider-color); margin: 10px 0 20px; }
          .kc-progress-bar { height: 100%; border-radius: 4px; background: var(--primary-color); transition: width 0.3s ease; }
          .kc-progress-tick { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--card-background-color); transform: translateX(-1px); }
          .kc-progress-tick span { position: absolute; top: 100%; left: 50%; transform: translateX(-50%); margin-top: 3px; font-size: 0.68em; font-weight: 600; color: var(--secondary-text-color); }
          .kc-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
          .kc-chip {
            border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color);
            border-radius: 16px; padding: 6px 12px; font-size: 0.85em; cursor: pointer;
          }
          .kc-chip:hover { background: var(--secondary-background-color); }
          .kc-chip-count { color: var(--secondary-text-color); }
          .kc-chip-deduct { border-color: var(--error-color, #db4437); color: var(--error-color, #db4437); }
          .kc-chip-reward { border-color: var(--primary-color); color: var(--primary-color); font-weight: 600; }
          .kc-chip-reward:disabled, .kc-chip-reward[disabled] { opacity: 0.4; cursor: default; }
          .kc-chip-pending { border-color: #c47700; color: #c47700; font-weight: 600; background: rgba(255, 167, 38, 0.12); }
          .kc-manual-row { display: flex; gap: 6px; align-items: center; margin-top: 4px; flex-wrap: wrap; }
          .kc-manual-row input[type="number"] { width: 60px; padding: 6px; border-radius: 6px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
          .kc-manual-row input[type="text"] { flex: 1; min-width: 120px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
          .kc-manual-row button { border-radius: 50%; width: 32px; height: 32px; border: none; font-size: 1.1em; cursor: pointer; }
          .kc-plus { background: var(--primary-color); color: var(--text-primary-color, #fff); }
          .kc-minus { background: var(--error-color, #db4437); color: #fff; }
          .kc-empty { color: var(--secondary-text-color); padding: 12px 0; }

          .kc-modal-list-btn {
            display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 10px 8px;
            border: none; border-bottom: 1px solid var(--divider-color); background: none; color: var(--primary-text-color);
            cursor: pointer; font-size: 0.95em;
          }
          .kc-modal-list-btn:last-child { border-bottom: none; }
          .kc-modal-list-btn:hover:not([disabled]) { background: var(--secondary-background-color); }
          .kc-modal-list-btn[disabled] { opacity: 0.4; cursor: default; }
          .kc-modal-list-amount { font-weight: 700; color: var(--primary-color); min-width: 2.2em; }
          .kc-modal-list-icon { font-size: 1.3em; }
          .kc-modal-deduct-row { display: flex; align-items: center; border-bottom: 1px solid var(--divider-color); }
          .kc-modal-deduct-row .kc-modal-list-btn { border-bottom: none; flex: 1; }
          .kc-deduct-amount { color: var(--error-color, #db4437) !important; }
          .kc-stepper { display: inline-flex; gap: 2px; padding-right: 8px; }
          .kc-stepper button { width: 22px; height: 22px; border-radius: 50%; border: none; background: var(--secondary-background-color); color: var(--primary-text-color); cursor: pointer; }
          .kc-history-row-full { padding: 8px 0; border-bottom: 1px solid var(--divider-color); }
          .kc-history-row-full:last-child { border-bottom: none; }
          .kc-history-reason { font-size: 0.95em; }
          .kc-history-meta { display: flex; gap: 10px; font-size: 0.8em; color: var(--secondary-text-color); margin-top: 2px; }
          .kc-history-meta .delta-pos { color: var(--success-color, #43a047); font-weight: 600; }
          .kc-history-meta .delta-neg { color: var(--error-color, #db4437); font-weight: 600; }
        </style>
        <ha-card ${title ? `header="${escapeAttr(title)}"` : ""}>
          <div class="card-content">
            <div class="kc-header">
              <div class="kc-avatar-wrap">
                ${renderAvatar(st, "kc-avatar")}
              </div>
              <div class="kc-name-actor">
                <div class="kc-name" data-action="open-history">${escapeAttr(name)}</div>
                ${this._config.actor ? `<div class="kc-actor">ingevuld door ${escapeAttr(this._config.actor)}</div>` : ""}
              </div>
              <div class="kc-balance">${balance} credits</div>
            </div>
            ${renderProgressBar(balance, threshold)}

            <div class="kc-chips">
              <button class="kc-chip ${pendingCount ? "kc-chip-pending" : ""}" data-action="open-requests">📥 Verzoeken <span class="kc-chip-count">${pendingCount}</span></button>
              ${chipsHtml}
              <button class="kc-chip kc-chip-deduct" data-action="open-deductions">&minus; Credits in mindering <span class="kc-chip-count">${deductions.length}</span></button>
              <button class="kc-chip kc-chip-reward" data-action="open-rewards" ${canRedeemAny ? "" : "disabled"}>🎁 Beloning uitkeren</button>
            </div>

            <div class="kc-manual-row">
              <input type="number" id="kc-manual-amount" placeholder="aantal" min="1" value="${escapeAttr(this._manualAmount)}" />
              <input type="text" id="kc-manual-reason" placeholder="reden" value="${escapeAttr(this._manualReason)}" />
              <button class="kc-plus" data-action="manual-plus" title="Toekennen">+</button>
              <button class="kc-minus" data-action="manual-minus" title="Afnemen">&minus;</button>
            </div>
          </div>
        </ha-card>
      `;

      this._bindEvents(kidId, st);
    }

    _bindEvents(kidId, st) {
      const groups = configGroups(this._config);
      const amountInput = this.shadowRoot.querySelector("#kc-manual-amount");
      const reasonInput = this.shadowRoot.querySelector("#kc-manual-reason");
      // Kept on the instance (not just the DOM) so a re-render that lands in
      // the gap between typing and tapping +/- (e.g. right after the
      // on-screen keyboard closes, no input focused) restores what was
      // typed instead of silently wiping it - see _doSafeRerender's focus
      // guard, which only protects values while an input is still focused.
      if (amountInput) amountInput.addEventListener("input", () => { this._manualAmount = amountInput.value; });
      if (reasonInput) reasonInput.addEventListener("input", () => { this._manualReason = reasonInput.value; });
      this.shadowRoot.querySelectorAll("[data-action]").forEach((el) => {
        const action = el.dataset.action;
        el.addEventListener("click", async () => {
          if (action === "open-group") {
            const group = groups.find((g) => String(g.points) === el.dataset.points);
            if (group) this._openGroupModal(kidId, group);
          } else if (action === "open-requests") {
            this._openRequestsModal(kidId, getKidEntity(this._hass, kidId) || st);
          } else if (action === "open-deductions") {
            this._openDeductionsModal(kidId);
          } else if (action === "open-rewards") {
            this._openRewardsModal(kidId, getKidEntity(this._hass, kidId) || st);
          } else if (action === "open-history") {
            this._openHistoryModal(getKidEntity(this._hass, kidId) || st);
          } else if (action === "manual-plus") {
            await this._manual(kidId, 1);
          } else if (action === "manual-minus") {
            await this._manual(kidId, -1);
          }
        });
      });
    }
  }

  // --------------------------------------------------------------------
  // Kids card - read-only for balances/history; its only service call is
  // request_credit, which never moves credits by itself (see the file-level
  // doc comment above). Meant for a shared kids tablet. `kids` config picks
  // which kid(s) show.
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
      this._safeRerender();
    }

    get hass() {
      return this._hass;
    }

    getCardSize() {
      return 4;
    }

    static getStubConfig() {
      return { title: "Onze credits", kids: [] };
    }

    static getConfigElement() {
      return document.createElement("kids-credits-kids-card-editor");
    }

    _safeRerender() {
      scheduleRerender(this, () => this._doSafeRerender());
    }

    _doSafeRerender() {
      if (!this.shadowRoot) return;
      if (this.shadowRoot.querySelector(".kc-modal-backdrop")) return;
      this._render();
    }

    _openHistoryModal(st) {
      const history = st.attributes.history || [];
      const body = history.length
        ? history
            .map(
              (h) => css`
                <div class="kc-history-row-full">
                  <div class="kc-history-reason">${escapeAttr(h.reason)}</div>
                  <div class="kc-history-meta">
                    <span class="${h.delta > 0 ? "delta-pos" : "delta-neg"}">${h.delta > 0 ? "+" : ""}${h.delta}</span>
                    <span>${formatWhen(h.created_at)}</span>
                    <span>${h.actor ? "door " + escapeAttr(h.actor) : ""}</span>
                  </div>
                </div>
              `
            )
            .join("")
        : `<div class="kc-empty">Nog geen geschiedenis</div>`;
      showModal(this.shadowRoot, `Geschiedenis van ${escapeAttr(st.attributes.friendly_name || "")}`, body);
    }

    async _notifyParentsOfRequest(kidId, message) {
      const kidName = (getKidEntity(this._hass, kidId) || {}).attributes?.friendly_name || kidId;
      await notifyAll(this._hass, this._config.notify_services, "Kids Credits", `${kidName}: ${message}`);
    }

    _openRequestFormModal(kidId) {
      // Big icon tiles with a short caption (full task text doesn't fit on
      // a tile and a 6-year-old can't read a long sentence anyway) - tapping
      // one goes to a confirm step showing the full description before
      // anything is actually sent. Falls back to free text for anything not
      // pictured.
      const groupsHtml = configGroups(this._config)
        .map((group) => {
          const tiles = group.tasks
            .map(normalizeTask)
            .map(
              (task) => css`
                <button
                  class="kc-icon-tile"
                  data-action="pick-task-request"
                  data-amount="${group.points}"
                  data-icon="${escapeAttr(task.icon)}"
                  data-reason="${escapeAttr(task.label)}"
                >
                  <span class="kc-icon-tile-emoji">${escapeAttr(task.icon)}</span>
                  <span class="kc-icon-tile-caption">${escapeAttr(task.short)}</span>
                </button>
              `
            )
            .join("");
          if (!tiles) return "";
          return css`
            <div class="kc-request-group-label">${escapeAttr(group.label)}</div>
            <div class="kc-icon-grid">${tiles}</div>
          `;
        })
        .join("");

      const body = css`
        ${groupsHtml}
        <div class="kc-request-form">
          <div class="kc-request-group-label">Iets anders</div>
          <textarea id="kc-request-reason" placeholder="Typ hier wat je hebt gedaan"></textarea>
          <button class="kc-request-submit" data-action="submit-text-request">Verzoek versturen</button>
        </div>
      `;
      const modal = showModal(this.shadowRoot, "Wat heb je gedaan?", body, { fullscreen: true, bigClose: true });
      modal.querySelectorAll('[data-action="pick-task-request"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          this._openConfirmRequestModal(kidId, {
            icon: btn.dataset.icon,
            reason: btn.dataset.reason,
            amount: parseInt(btn.dataset.amount, 10),
          });
        });
      });
      modal.querySelector('[data-action="submit-text-request"]').addEventListener("click", async () => {
        const textarea = modal.querySelector("#kc-request-reason");
        const reason = textarea.value.trim();
        if (!reason) return;
        await callService(this._hass, "request_credit", { kid_id: kidId, reason });
        hideModal(this.shadowRoot);
        await this._notifyParentsOfRequest(kidId, `vraagt credits aan voor "${reason}"`);
      });
    }

    _openConfirmRequestModal(kidId, task) {
      const body = css`
        <div class="kc-confirm-body">
          <span class="kc-confirm-emoji">${escapeAttr(task.icon)}</span>
          <div class="kc-confirm-label">${escapeAttr(task.reason)}</div>
          <div class="kc-confirm-buttons">
            <button class="kc-confirm-yes" data-action="confirm-yes">✅ Ja, versturen</button>
            <button class="kc-confirm-back" data-action="confirm-back">↩️ Terug</button>
          </div>
        </div>
      `;
      const modal = showModal(this.shadowRoot, "Klopt dit?", body, { fullscreen: true, bigClose: true });
      modal.querySelector('[data-action="confirm-yes"]').addEventListener("click", async () => {
        await callService(this._hass, "request_credit", {
          kid_id: kidId,
          reason: task.reason,
          suggested_amount: task.amount,
        });
        hideModal(this.shadowRoot);
        await this._notifyParentsOfRequest(kidId, `vraagt credits aan voor "${task.reason}"`);
      });
      modal.querySelector('[data-action="confirm-back"]').addEventListener("click", () => {
        this._openRequestFormModal(kidId);
      });
    }

    _openRequestsOverviewModal(st) {
      const requests = st.attributes.requests || [];
      const body = requests.length
        ? requests
            .map(
              (r) => css`
                <div class="kc-request-row">
                  <div class="kc-request-top">
                    <span class="kc-request-reason">${r.kind === "reward" ? "🎁" : "✋"} ${escapeAttr(r.reason)}</span>
                    ${statusBadge(r.status)}
                  </div>
                  <div class="kc-request-meta">
                    ${formatWhen(r.created_at)}
                    ${r.status === "approved" ? ` · ${r.kind === "reward" ? "-" : "+"}${r.amount} credits` : ""}
                    ${r.actor ? ` · door ${escapeAttr(r.actor)}` : ""}
                  </div>
                </div>
              `
            )
            .join("")
        : `<div class="kc-empty">Nog geen verzoeken</div>`;
      showModal(this.shadowRoot, `Verzoeken van ${escapeAttr(st.attributes.friendly_name || "")}`, body);
    }

    _render() {
      if (!this.shadowRoot) return;
      const hass = this._hass;
      const allKids = getKidEntities(hass);
      const wanted = this._config.kids && this._config.kids.length ? this._config.kids : null;
      const kids = wanted
        ? wanted.map((id) => allKids.find((st) => st.attributes.kid_id === id)).filter(Boolean)
        : allKids;
      const title = this._config.title || "Onze credits";
      const showTitle = this._config.show_title !== false;

      const kidsHtml = kids.length
        ? css`<div class="kc-grid">${kids.map((st) => this._renderKid(st)).join("")}</div>`
        : `<div class="kc-empty">Geen kinderen gekozen of gevonden.</div>`;

      this.shadowRoot.innerHTML = css`
        <style>
          ${MODAL_STYLE}
          ${REQUEST_STYLE}
          :host { display: block; }
          ha-card { padding: 20px; }
          .card-content { container-type: inline-size; }
          .kc-title { font-size: 1.4em; font-weight: 700; margin-bottom: 16px; text-align: center; }
          .kc-grid { display: flex; gap: 20px; flex-wrap: wrap; justify-content: center; }
          .kc-kid-tile {
            flex: 1 1 240px; max-width: 340px; text-align: center; border-radius: 16px;
            background: var(--secondary-background-color); padding: 20px 16px;
          }
          /* Narrow (e.g. a portrait tablet) - stack instead of squeezing
             side by side, and let each kid use the full width rather than
             staying capped at 340px. */
          @container (max-width: 600px) {
            .kc-grid { flex-direction: column; }
            .kc-kid-tile { max-width: none; box-sizing: border-box; }
          }
          .kc-kid-icon { --mdc-icon-size: 192px; color: var(--primary-color); }
          .kc-kid-icon, img.kc-kid-icon { width: 192px; height: 192px; border-radius: 50%; object-fit: cover; cursor: pointer; }
          .kc-kid-name { font-size: 1.2em; font-weight: 700; margin: 8px 0 4px; cursor: pointer; }
          .kc-kid-name:hover { text-decoration: underline; }
          .kc-kid-balance { font-size: 2.4em; font-weight: 800; color: var(--primary-color); line-height: 1; }
          .kc-kid-unit { font-size: 0.5em; font-weight: 500; color: var(--secondary-text-color); }
          .kc-progress-wrap { position: relative; height: 14px; border-radius: 7px; background: var(--divider-color); margin: 12px 0 16px; }
          .kc-progress-bar { height: 100%; border-radius: 7px; background: linear-gradient(90deg, var(--primary-color), var(--success-color, #43a047)); transition: width 0.4s ease; }
          .kc-progress-tick { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--card-background-color); transform: translateX(-1px); }
          .kc-progress-tick span { position: absolute; top: 100%; left: 50%; transform: translateX(-50%); margin-top: 3px; font-size: 0.7em; font-weight: 600; color: var(--secondary-text-color); }
          .kc-progress-label { font-size: 0.85em; color: var(--secondary-text-color); }
          .kc-empty { color: var(--secondary-text-color); text-align: center; padding: 20px 0; }
          .kc-history-row-full { padding: 8px 0; border-bottom: 1px solid var(--divider-color); text-align: left; }
          .kc-history-row-full:last-child { border-bottom: none; }
          .kc-history-reason { font-size: 0.95em; }
          .kc-history-meta { display: flex; gap: 10px; font-size: 0.8em; color: var(--secondary-text-color); margin-top: 2px; }
          .kc-history-meta .delta-pos { color: var(--success-color, #43a047); font-weight: 600; }
          .kc-history-meta .delta-neg { color: var(--error-color, #db4437); font-weight: 600; }
          .kc-request-btn {
            display: block; width: 100%; margin-top: 12px; border: none; border-radius: 16px; padding: 8px 12px;
            background: var(--primary-color); color: var(--text-primary-color, #fff); font-weight: 600; cursor: pointer;
          }
          .kc-reward-request-btn {
            display: block; width: 100%; margin-top: 10px; border: none; border-radius: 16px; padding: 8px 12px;
            background: var(--success-color, #43a047); color: #fff; font-weight: 700; cursor: pointer;
          }
          .kc-reward-pending {
            margin-top: 10px; font-size: 0.8em; font-weight: 600; color: var(--success-color, #43a047);
          }
          .kc-requests-link {
            display: block; margin-top: 6px; font-size: 0.8em; color: var(--secondary-text-color);
            background: none; border: none; cursor: pointer; text-decoration: underline; padding: 0;
          }
        </style>
        <ha-card>
          <div class="card-content">
            ${showTitle ? `<div class="kc-title">${escapeAttr(title)}</div>` : ""}
            ${kidsHtml}
          </div>
        </ha-card>
      `;

      this.shadowRoot.querySelectorAll("[data-action='open-history']").forEach((el) => {
        el.addEventListener("click", () => {
          const st = kids.find((k) => k.attributes.kid_id === el.dataset.kid);
          if (st) this._openHistoryModal(st);
        });
      });
      this.shadowRoot.querySelectorAll("[data-action='request-credit']").forEach((el) => {
        el.addEventListener("click", () => this._openRequestFormModal(el.dataset.kid));
      });
      this.shadowRoot.querySelectorAll("[data-action='request-reward']").forEach((el) => {
        el.addEventListener("click", async () => {
          const amount = parseInt(el.dataset.amount, 10);
          const reason = `Beloning bij ${amount} credits`;
          await callService(this._hass, "request_reward", { kid_id: el.dataset.kid, reason, amount });
          await this._notifyParentsOfRequest(el.dataset.kid, `vraagt een beloning aan (${amount} credits)`);
        });
      });
      this.shadowRoot.querySelectorAll("[data-action='open-requests']").forEach((el) => {
        el.addEventListener("click", () => {
          const st = kids.find((k) => k.attributes.kid_id === el.dataset.kid);
          if (st) this._openRequestsOverviewModal(st);
        });
      });
    }

    _renderKid(st) {
      const name = st.attributes.friendly_name || st.attributes.kid_id;
      const balance = Number(st.state) || 0;
      const threshold = st.attributes.reward_threshold || 15;
      const ready = balance >= threshold;
      const kidId = escapeAttr(st.attributes.kid_id);
      const requests = st.attributes.requests || [];
      const pendingCount = requests.filter((r) => r.status === "pending").length;
      const hasPendingReward = requests.some((r) => r.kind === "reward" && r.status === "pending");

      const rewardButtonHtml = ready
        ? hasPendingReward
          ? `<div class="kc-reward-pending">🎁 Beloning aangevraagd, wacht op goedkeuring</div>`
          : css`
              <button class="kc-reward-request-btn" data-action="request-reward" data-kid="${kidId}" data-amount="${threshold}">
                🎁 Beloning aanvragen
              </button>
            `
        : "";

      return css`
        <div class="kc-kid-tile">
          <span data-action="open-history" data-kid="${kidId}">${renderAvatar(st, "kc-kid-icon")}</span>
          <div class="kc-kid-name" data-action="open-history" data-kid="${kidId}">${escapeAttr(name)}</div>
          <div class="kc-kid-balance">${balance}<span class="kc-kid-unit"> credits</span></div>
          ${renderProgressBar(balance, threshold)}
          <div class="kc-progress-label">${ready ? "Beloning verdiend! 🎉" : `nog ${threshold - balance} tot een beloning`}</div>
          ${rewardButtonHtml}
          <button class="kc-request-btn" data-action="request-credit" data-kid="${kidId}">✋ Ik heb een klus gedaan!</button>
          <button class="kc-requests-link" data-action="open-requests" data-kid="${kidId}">
            ${requests.length ? `${requests.length} verzoek${requests.length === 1 ? "" : "en"}${pendingCount ? ` (${pendingCount} in afwachting)` : ""}` : "Nog geen verzoeken"}
          </button>
        </div>
      `;
    }
  }

  // --------------------------------------------------------------------
  // Shared editor helpers
  // --------------------------------------------------------------------
  const EDITOR_STYLE = css`
    .kce-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
    .kce-field label { font-size: 0.85em; color: var(--secondary-text-color); }
    .kce-field input[type="text"], .kce-field select, .kce-field input[type="number"] {
      padding: 8px; border-radius: 6px; border: 1px solid var(--divider-color);
      background: var(--card-background-color); color: var(--primary-text-color);
    }
    .kce-section {
      border: 1px solid var(--divider-color); border-radius: 8px; margin-bottom: 12px; overflow: hidden;
    }
    .kce-section-header {
      display: flex; align-items: center; justify-content: space-between; padding: 10px 12px;
      background: var(--secondary-background-color); cursor: pointer; font-weight: 600;
    }
    .kce-section-header-static { cursor: default; }
    .kce-section-header .kce-chevron { transition: transform 0.15s ease; }
    .kce-section-header.kce-collapsed .kce-chevron { transform: rotate(-90deg); }
    .kce-section-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .kce-section-body.kce-hidden { display: none; }
    .kce-group-box { border: 1px solid var(--divider-color); border-radius: 6px; padding: 10px; }
    .kce-group-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
    .kce-group-row input[type="number"] { width: 70px; }
    .kce-group-row input[type="text"] { flex: 1; }
    .kce-task-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
    .kce-task-row input { flex: 1; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
    .kce-task-row input.kce-task-icon { flex: none; width: 44px; text-align: center; font-size: 1.1em; }
    .kce-remove-btn {
      width: 24px; height: 24px; border-radius: 50%; border: none; background: var(--error-color, #db4437);
      color: #fff; cursor: pointer; flex-shrink: 0; line-height: 1;
    }
    .kce-add-btn {
      align-self: flex-start; border: 1px dashed var(--divider-color); background: none; color: var(--primary-color);
      border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 0.9em;
    }
    .kce-remove-group-btn {
      border: none; background: none; color: var(--error-color, #db4437); cursor: pointer; font-size: 0.85em;
      margin-top: 4px;
    }
    .kce-reward-row { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
    .kce-reward-row input[type="text"] { flex: 1; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
    .kce-reward-row input[type="number"] { width: 70px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
    .kce-danger-btn {
      border: 1px solid var(--error-color, #db4437); background: none; color: var(--error-color, #db4437);
      border-radius: 6px; padding: 8px 12px; cursor: pointer; font-size: 0.9em; text-align: left;
    }
    .kce-photo-row { display: flex; align-items: center; gap: 10px; }
    .kce-photo-preview { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; --mdc-icon-size: 44px; color: var(--primary-color); }
    img.kce-photo-preview { background: var(--secondary-background-color); }
  `;

  function fireConfigChanged(el, config) {
    el.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  // Shared between KidsCreditsParentCardEditor and KidsCreditsKidsCardEditor
  // (both a task catalog to award from and a task catalog to request from
  // need the same "groups of tasks worth N credits" editing UI). Any editor
  // using these must implement: self._config, self._expanded.groups (a
  // plain object keyed by group index), self._updateGroups(groups), and
  // self._render().
  function groupsSectionHtml(config, expandedGroups) {
    const groups = configGroups(config);
    return groups
      .map((group, idx) => {
        const expanded = !!expandedGroups[idx];
        const tasksHtml = group.tasks
          .map(normalizeTask)
          .map(
            (task, taskIdx) => css`
              <div class="kce-task-row">
                <input type="text" class="kce-task-icon" value="${escapeAttr(task.icon)}" data-group="${idx}" data-task="${taskIdx}" data-field="task-icon" title="Icoon (emoji)" />
                <input type="text" value="${escapeAttr(task.label)}" data-group="${idx}" data-task="${taskIdx}" data-field="task-label" placeholder="Taak" />
                <button class="kce-remove-btn" data-action="remove-task" data-group="${idx}" data-task="${taskIdx}">&times;</button>
              </div>
            `
          )
          .join("");
        return css`
          <div class="kce-group-box">
            <div class="kce-section-header ${expanded ? "" : "kce-collapsed"}" data-action="toggle-group" data-group="${idx}">
              <span>${escapeAttr(group.label)} (${group.tasks.length})</span>
              <span class="kce-chevron">▾</span>
            </div>
            ${expanded
              ? css`
                  <div class="kce-group-row">
                    <input type="number" min="0" value="${group.points}" data-group="${idx}" data-field="points" title="Credits" />
                    <input type="text" value="${escapeAttr(group.label)}" data-group="${idx}" data-field="label" placeholder="Naam van de groep" />
                  </div>
                  ${tasksHtml}
                  <button class="kce-add-btn" data-action="add-task" data-group="${idx}">+ Taak toevoegen</button>
                  <br />
                  <button class="kce-remove-group-btn" data-action="remove-group" data-group="${idx}">Groep verwijderen</button>
                `
              : ""}
          </div>
        `;
      })
      .join("");
  }

  function bindGroupsSection(root, self) {
    root.querySelectorAll('[data-action="toggle-group"]').forEach((el) => {
      el.addEventListener("click", () => {
        const idx = el.dataset.group;
        self._expanded.groups[idx] = !self._expanded.groups[idx];
        self._render();
      });
    });

    root.querySelectorAll('[data-field="points"], [data-field="label"]').forEach((el) => {
      el.addEventListener("change", () => {
        const groups = configGroups(self._config).map((g) => ({ ...g, tasks: [...g.tasks] }));
        const idx = parseInt(el.dataset.group, 10);
        if (el.dataset.field === "points") groups[idx].points = parseInt(el.value, 10) || 0;
        else groups[idx].label = el.value;
        self._updateGroups(groups);
      });
    });

    root.querySelectorAll('[data-field="task-icon"], [data-field="task-label"]').forEach((el) => {
      el.addEventListener("change", () => {
        const groups = configGroups(self._config).map((g) => ({ ...g, tasks: g.tasks.map(normalizeTask).map((t) => ({ ...t })) }));
        const gIdx = parseInt(el.dataset.group, 10);
        const tIdx = parseInt(el.dataset.task, 10);
        if (el.dataset.field === "task-icon") groups[gIdx].tasks[tIdx].icon = el.value;
        else groups[gIdx].tasks[tIdx].label = el.value;
        self._updateGroups(groups);
      });
    });

    root.querySelectorAll('[data-action="add-task"]').forEach((el) => {
      el.addEventListener("click", () => {
        const groups = configGroups(self._config).map((g) => ({ ...g, tasks: g.tasks.map(normalizeTask).map((t) => ({ ...t })) }));
        const idx = parseInt(el.dataset.group, 10);
        groups[idx].tasks.push({ icon: "⭐", label: "Nieuwe taak" });
        self._expanded.groups[idx] = true;
        self._updateGroups(groups);
      });
    });

    root.querySelectorAll('[data-action="remove-task"]').forEach((el) => {
      el.addEventListener("click", () => {
        const groups = configGroups(self._config).map((g) => ({ ...g, tasks: [...g.tasks] }));
        const gIdx = parseInt(el.dataset.group, 10);
        groups[gIdx].tasks.splice(parseInt(el.dataset.task, 10), 1);
        self._updateGroups(groups);
      });
    });

    const addGroupBtn = root.querySelector('[data-action="add-group"]');
    if (addGroupBtn) {
      addGroupBtn.addEventListener("click", () => {
        const groups = configGroups(self._config).map((g) => ({ ...g, tasks: [...g.tasks] }));
        groups.push({ points: 1, label: "Nieuwe groep", tasks: [] });
        self._expanded.groups[groups.length - 1] = true;
        self._updateGroups(groups);
      });
    }

    root.querySelectorAll('[data-action="remove-group"]').forEach((el) => {
      el.addEventListener("click", () => {
        const groups = configGroups(self._config).map((g) => ({ ...g, tasks: [...g.tasks] }));
        groups.splice(parseInt(el.dataset.group, 10), 1);
        self._updateGroups(groups);
      });
    });
  }

  // --------------------------------------------------------------------
  // Parent card editor
  // --------------------------------------------------------------------
  class KidsCreditsParentCardEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._config = {};
      this._expanded = { deductions: false, rewards: false, groups: {} };
      this._clearHistoryArmed = false;
    }

    setConfig(config) {
      this._config = { ...config };
      this._render();
    }

    set hass(hass) {
      this._hass = hass;
      this._safeRerender();
    }

    get hass() {
      return this._hass;
    }

    _safeRerender() {
      scheduleRerender(this, () => this._doSafeRerender());
    }

    _doSafeRerender() {
      if (!this.shadowRoot) return;
      const active = this.shadowRoot.activeElement;
      if (active && active.matches && active.matches(FOCUSABLE_INPUT_SELECTOR)) return;
      this._render();
    }

    _update(patch) {
      this._config = { ...this._config, ...patch };
      fireConfigChanged(this, this._config);
      this._render();
    }

    _updateGroups(groups) {
      this._update({ groups });
    }

    _render() {
      if (!this.shadowRoot) return;
      const hass = this._hass;
      const config = this._config;
      const kids = getKidEntities(hass);
      const notifyServices = getNotifyServices(hass);
      const deductions = configDeductions(config);
      const rewards = config.rewards && config.rewards.length ? config.rewards : [];

      const kidOptions = kids
        .map(
          (st) =>
            `<option value="${escapeAttr(st.attributes.kid_id)}" ${st.attributes.kid_id === config.kid_id ? "selected" : ""}>${escapeAttr(st.attributes.friendly_name)}</option>`
        )
        .join("");

      const selectedKid = kids.find((st) => st.attributes.kid_id === config.kid_id);
      const photoPreviewHtml = selectedKid
        ? css`
            <div class="kce-photo-row">
              ${renderAvatar(selectedKid, "kce-photo-preview")}
              <button class="kce-add-btn" data-action="upload-photo">📷 Foto uploaden</button>
              ${selectedKid.attributes.photo
                ? `<button class="kce-remove-group-btn" data-action="remove-photo">Foto verwijderen</button>`
                : ""}
            </div>
          `
        : "";

      const notifyOptions =
        `<option value="">(geen)</option>` +
        notifyServices
          .map(
            (svc) =>
              `<option value="notify.${escapeAttr(svc)}" ${config.notify_service === "notify." + svc ? "selected" : ""}>notify.${escapeAttr(svc)}</option>`
          )
          .join("");

      const groupsHtml = groupsSectionHtml(config, this._expanded.groups);

      const deductionsHtml = deductions
        .map(
          (reason, idx) => css`
            <div class="kce-task-row">
              <input type="text" value="${escapeAttr(reason)}" data-deduction="${idx}" />
              <button class="kce-remove-btn" data-action="remove-deduction" data-deduction="${idx}">&times;</button>
            </div>
          `
        )
        .join("");

      const rewardsHtml = rewards
        .map(
          (reward, idx) => css`
            <div class="kce-reward-row">
              <input type="text" value="${escapeAttr(reward.label)}" placeholder="Naam beloning" data-reward="${idx}" data-field="label" />
              <input type="number" min="1" value="${reward.cost}" placeholder="Credits" data-reward="${idx}" data-field="cost" />
              <button class="kce-remove-btn" data-action="remove-reward" data-reward="${idx}">&times;</button>
            </div>
          `
        )
        .join("");

      this.shadowRoot.innerHTML = css`
        <style>${EDITOR_STYLE}</style>
        <div class="kce-field">
          <label>Titel (optioneel)</label>
          <input type="text" id="kce-title" value="${escapeAttr(config.title || "")}" />
        </div>
        <div class="kce-field">
          <label>Kind</label>
          <select id="kce-kid">${kidOptions || '<option value="">Geen kinderen gevonden</option>'}</select>
        </div>
        <div class="kce-field">
          <label>Foto van dit kind</label>
          ${photoPreviewHtml}
        </div>
        <div class="kce-field">
          <label>Geschiedenis</label>
          <button class="kce-danger-btn" data-action="clear-history">
            ${this._clearHistoryArmed ? "Zeker weten? Nogmaals klikken wist alles en zet saldo op 0" : "🗑️ Geschiedenis wissen"}
          </button>
        </div>
        <div class="kce-field">
          <label>Ouder (wie gebruikt deze kaart)</label>
          <input type="text" id="kce-actor" value="${escapeAttr(config.actor || "")}" placeholder="papa / mama" />
        </div>
        <div class="kce-field">
          <label>Pushbericht bij beloning (optioneel)</label>
          <select id="kce-notify">${notifyOptions}</select>
        </div>

        <div class="kce-section">
          <div class="kce-section-header kce-section-header-static">
            <span>Taken per aantal credits</span>
          </div>
          <div class="kce-section-body">
            ${groupsHtml}
            <button class="kce-add-btn" data-action="add-group">+ Nieuwe groep</button>
          </div>
        </div>

        <div class="kce-section">
          <div class="kce-section-header ${this._expanded.deductions ? "" : "kce-collapsed"}" data-action="toggle-section" data-section="deductions">
            <span>Credits in mindering (${deductions.length})</span>
            <span class="kce-chevron">▾</span>
          </div>
          <div class="kce-section-body ${this._expanded.deductions ? "" : "kce-hidden"}">
            ${deductionsHtml}
            <button class="kce-add-btn" data-action="add-deduction">+ Reden toevoegen</button>
          </div>
        </div>

        <div class="kce-section">
          <div class="kce-section-header ${this._expanded.rewards ? "" : "kce-collapsed"}" data-action="toggle-section" data-section="rewards">
            <span>Beloningen (${rewards.length || "standaard"})</span>
            <span class="kce-chevron">▾</span>
          </div>
          <div class="kce-section-body ${this._expanded.rewards ? "" : "kce-hidden"}">
            ${rewardsHtml}
            <button class="kce-add-btn" data-action="add-reward">+ Beloning toevoegen</button>
          </div>
        </div>
      `;

      this._bind();
    }

    _bind() {
      const root = this.shadowRoot;

      root.querySelector("#kce-title").addEventListener("change", (e) => this._update({ title: e.target.value }));
      root.querySelector("#kce-kid").addEventListener("change", (e) => this._update({ kid_id: e.target.value }));
      root.querySelector("#kce-actor").addEventListener("change", (e) => this._update({ actor: e.target.value }));
      root.querySelector("#kce-notify").addEventListener("change", (e) => this._update({ notify_service: e.target.value || undefined }));

      const uploadPhotoBtn = root.querySelector('[data-action="upload-photo"]');
      if (uploadPhotoBtn) {
        uploadPhotoBtn.addEventListener("click", async () => {
          if (this._config.kid_id) await promptPhotoUpload(this._hass, this._config.kid_id);
        });
      }
      const removePhotoBtn = root.querySelector('[data-action="remove-photo"]');
      if (removePhotoBtn) {
        removePhotoBtn.addEventListener("click", async () => {
          if (this._config.kid_id) await callService(this._hass, "set_kid_photo", { kid_id: this._config.kid_id, photo: "" });
        });
      }

      const clearHistoryBtn = root.querySelector('[data-action="clear-history"]');
      if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener("click", async () => {
          if (!this._clearHistoryArmed) {
            this._clearHistoryArmed = true;
            this._render();
            setTimeout(() => {
              if (this._clearHistoryArmed) {
                this._clearHistoryArmed = false;
                this._render();
              }
            }, 4000);
            return;
          }
          this._clearHistoryArmed = false;
          if (this._config.kid_id) await callService(this._hass, "clear_history", { kid_id: this._config.kid_id });
          this._render();
        });
      }

      root.querySelectorAll('[data-action="toggle-section"]').forEach((el) => {
        el.addEventListener("click", () => {
          const section = el.dataset.section;
          this._expanded[section] = !this._expanded[section];
          this._render();
        });
      });

      bindGroupsSection(root, this);

      root.querySelectorAll('input[data-deduction]').forEach((el) => {
        el.addEventListener("change", () => {
          const deductions = [...configDeductions(this._config)];
          deductions[parseInt(el.dataset.deduction, 10)] = el.value;
          this._update({ deductions });
        });
      });

      root.querySelectorAll('[data-action="remove-deduction"]').forEach((el) => {
        el.addEventListener("click", () => {
          const deductions = [...configDeductions(this._config)];
          deductions.splice(parseInt(el.dataset.deduction, 10), 1);
          this._update({ deductions });
        });
      });

      const addDeductionBtn = root.querySelector('[data-action="add-deduction"]');
      if (addDeductionBtn) {
        addDeductionBtn.addEventListener("click", () => {
          const deductions = [...configDeductions(this._config), "Nieuwe reden"];
          this._expanded.deductions = true;
          this._update({ deductions });
        });
      }

      root.querySelectorAll('[data-reward]').forEach((el) => {
        el.addEventListener("change", () => {
          const rewards = (this._config.rewards || []).map((r) => ({ ...r }));
          const idx = parseInt(el.dataset.reward, 10);
          if (el.dataset.field === "cost") rewards[idx].cost = parseInt(el.value, 10) || 0;
          else rewards[idx].label = el.value;
          this._update({ rewards });
        });
      });

      root.querySelectorAll('[data-action="remove-reward"]').forEach((el) => {
        el.addEventListener("click", () => {
          const rewards = (this._config.rewards || []).map((r) => ({ ...r }));
          rewards.splice(parseInt(el.dataset.reward, 10), 1);
          this._update({ rewards });
        });
      });

      const addRewardBtn = root.querySelector('[data-action="add-reward"]');
      if (addRewardBtn) {
        addRewardBtn.addEventListener("click", () => {
          const rewards = [...(this._config.rewards || []), { label: "Nieuwe beloning", cost: 15 }];
          this._expanded.rewards = true;
          this._update({ rewards });
        });
      }
    }
  }

  // --------------------------------------------------------------------
  // Kids card editor
  // --------------------------------------------------------------------
  class KidsCreditsKidsCardEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._config = {};
      this._expanded = { groups: {} };
    }

    setConfig(config) {
      this._config = { ...config };
      this._render();
    }

    set hass(hass) {
      this._hass = hass;
      this._safeRerender();
    }

    get hass() {
      return this._hass;
    }

    _safeRerender() {
      scheduleRerender(this, () => this._doSafeRerender());
    }

    _doSafeRerender() {
      if (!this.shadowRoot) return;
      const active = this.shadowRoot.activeElement;
      if (active && active.matches && active.matches(FOCUSABLE_INPUT_SELECTOR)) return;
      this._render();
    }

    _update(patch) {
      this._config = { ...this._config, ...patch };
      fireConfigChanged(this, this._config);
      this._render();
    }

    _updateGroups(groups) {
      this._update({ groups });
    }

    _render() {
      if (!this.shadowRoot) return;
      const hass = this._hass;
      const config = this._config;
      const allKids = getKidEntities(hass);
      const groupsHtml = groupsSectionHtml(config, this._expanded.groups);
      const notifyServices = getNotifyServices(hass);
      const selectedNotify = new Set(config.notify_services || []);

      // config.kids (when set) is both "which kids show" AND the order they
      // show in - configured ids first (in their saved order), then any
      // other known kid not yet included, appended alphabetically.
      const configuredIds = config.kids && config.kids.length ? config.kids.filter((id) => allKids.some((k) => k.attributes.kid_id === id)) : [];
      const remainingIds = allKids.map((k) => k.attributes.kid_id).filter((id) => !configuredIds.includes(id));
      const kidOrder = [...configuredIds, ...remainingIds];
      const checkedIds = new Set(config.kids && config.kids.length ? config.kids : allKids.map((k) => k.attributes.kid_id));

      const checkboxesHtml = kidOrder.length
        ? kidOrder
            .map((id, idx) => {
              const st = allKids.find((k) => k.attributes.kid_id === id);
              const name = st ? st.attributes.friendly_name : id;
              return css`
                <div class="kce-kid-row">
                  <label class="kce-checkbox-row">
                    <input type="checkbox" data-kid="${escapeAttr(id)}" ${checkedIds.has(id) ? "checked" : ""} />
                    ${escapeAttr(name)}
                  </label>
                  <span class="kce-kid-move">
                    <button type="button" data-move="up" data-kid="${escapeAttr(id)}" ${idx === 0 ? "disabled" : ""}>▲</button>
                    <button type="button" data-move="down" data-kid="${escapeAttr(id)}" ${idx === kidOrder.length - 1 ? "disabled" : ""}>▼</button>
                  </span>
                </div>
              `;
            })
            .join("")
        : `<div class="kce-empty">Geen kinderen gevonden - stel Kids Credits eerst in.</div>`;

      const notifyCheckboxesHtml = notifyServices.length
        ? notifyServices
            .map((svc) => {
              const fullId = `notify.${svc}`;
              return css`
                <label class="kce-checkbox-row">
                  <input type="checkbox" data-notify="${escapeAttr(fullId)}" ${selectedNotify.has(fullId) ? "checked" : ""} />
                  ${escapeAttr(fullId)}
                </label>
              `;
            })
            .join("")
        : `<div class="kce-empty">Geen notify-services gevonden.</div>`;

      this.shadowRoot.innerHTML = css`
        <style>
          ${EDITOR_STYLE}
          .kce-checkbox-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; cursor: pointer; }
          .kce-empty { color: var(--secondary-text-color); }
          .kce-hint { font-size: 0.8em; color: var(--secondary-text-color); margin-top: 4px; }
          .kce-kid-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
          .kce-kid-move { display: flex; gap: 4px; flex-shrink: 0; }
          .kce-kid-move button {
            width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--divider-color);
            background: var(--card-background-color); color: var(--primary-text-color); cursor: pointer;
          }
          .kce-kid-move button:disabled { opacity: 0.3; cursor: default; }
        </style>
        <div class="kce-field">
          <label>Titel</label>
          <input type="text" id="kce-title" value="${escapeAttr(config.title || "")}" />
        </div>
        <div class="kce-field">
          <label><input type="checkbox" id="kce-show-title" ${config.show_title !== false ? "checked" : ""} /> Titel tonen</label>
        </div>
        <div class="kce-field">
          <label>Kinderen op deze kaart (volgorde = weergavevolgorde)</label>
          ${checkboxesHtml}
          <div class="kce-hint">Niks aangevinkt = alle kinderen tonen. Pijltjes verplaatsen een kind naar boven/onder.</div>
        </div>
        <div class="kce-field">
          <label>Pushbericht naar bij een verzoek</label>
          ${notifyCheckboxesHtml}
          <div class="kce-hint">Alle aangevinkte telefoons krijgen een bericht zodra een kind credits of een beloning aanvraagt.</div>
        </div>

        <div class="kce-section">
          <div class="kce-section-header kce-section-header-static">
            <span>Taken (knoppen bij "Ik heb een klus gedaan")</span>
          </div>
          <div class="kce-section-body">
            ${groupsHtml}
            <button class="kce-add-btn" data-action="add-group">+ Nieuwe groep</button>
          </div>
        </div>
        <div class="kce-hint">Zelfde standaardtaken als de ouderkaart tenzij hier aangepast.</div>
      `;

      const titleInput = this.shadowRoot.querySelector("#kce-title");
      if (titleInput) titleInput.addEventListener("change", (e) => this._update({ title: e.target.value }));

      const showTitleInput = this.shadowRoot.querySelector("#kce-show-title");
      if (showTitleInput) showTitleInput.addEventListener("change", (e) => this._update({ show_title: e.target.checked }));

      bindGroupsSection(this.shadowRoot, this);

      this.shadowRoot.querySelectorAll("input[data-kid]").forEach((el) => {
        el.addEventListener("change", () => {
          // DOM order already matches kidOrder (rows render in that order).
          const checked = Array.from(this.shadowRoot.querySelectorAll("input[data-kid]:checked")).map((c) => c.dataset.kid);
          this._update({ kids: checked });
        });
      });

      this.shadowRoot.querySelectorAll("[data-move]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.kid;
          const dir = btn.dataset.move;
          const order = kidOrder.slice();
          const i = order.indexOf(id);
          const j = dir === "up" ? i - 1 : i + 1;
          if (i < 0 || j < 0 || j >= order.length) return;
          [order[i], order[j]] = [order[j], order[i]];
          this._update({ kids: order.filter((kid) => checkedIds.has(kid)) });
        });
      });

      this.shadowRoot.querySelectorAll("input[data-notify]").forEach((el) => {
        el.addEventListener("change", () => {
          const checked = Array.from(this.shadowRoot.querySelectorAll("input[data-notify]:checked")).map((c) => c.dataset.notify);
          this._update({ notify_services: checked });
        });
      });
    }
  }

  // --------------------------------------------------------------------
  // Rules card - a collapsible, editable block of house rules. Purely
  // static/config-driven (no service calls, no live entity data beyond the
  // ambient theme), so no hass-triggered re-rendering is needed.
  // --------------------------------------------------------------------
  const DEFAULT_RULES = [
    "## Spelregels",
    "",
    "- Voor elke klus die je doet krijg je credits.",
    "- Bij genoeg credits mag je een beloning kiezen.",
    "- Sparen mag: hoe meer credits, hoe grotere beloning.",
    "- Rotzooien of niet luisteren kan credits kosten.",
  ].join("\n");

  // Deliberately tiny - just enough markdown for a rules list (headings,
  // bullet lists, paragraphs, bold/italic), not a general parser.
  function renderRulesMarkdown(text) {
    const lines = escapeAttr(text || "").split("\n");
    let html = "";
    let inList = false;
    const closeList = () => {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
    };
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        closeList();
        continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.*)/);
      if (heading) {
        closeList();
        const level = heading[1].length + 2;
        html += `<h${level}>${heading[2]}</h${level}>`;
        continue;
      }
      if (line.startsWith("- ")) {
        if (!inList) {
          html += "<ul>";
          inList = true;
        }
        html += `<li>${line.slice(2)}</li>`;
        continue;
      }
      closeList();
      html += `<p>${line}</p>`;
    }
    closeList();
    return html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
  }

  class KidsCreditsRulesCard extends HTMLElement {
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
    }

    get hass() {
      return this._hass;
    }

    getCardSize() {
      return 2;
    }

    static getStubConfig() {
      return { title: "Spelregels", rules: DEFAULT_RULES, collapsed: true };
    }

    static getConfigElement() {
      return document.createElement("kids-credits-rules-card-editor");
    }

    _render() {
      if (!this.shadowRoot) return;
      const title = this._config.title || "Spelregels";
      const rules = this._config.rules || DEFAULT_RULES;
      const collapsed = this._config.collapsed !== false;
      this.shadowRoot.innerHTML = css`
        <style>
          :host { display: block; }
          ha-card { padding: 4px 16px; }
          details summary { padding: 12px 0; font-weight: 700; font-size: 1.05em; cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; color: var(--primary-text-color); }
          details summary::-webkit-details-marker { display: none; }
          details summary::before { content: "▸"; display: inline-block; transition: transform 0.15s ease; }
          details[open] summary::before { transform: rotate(90deg); }
          .kc-rules-body { padding: 0 0 16px; color: var(--primary-text-color); }
          .kc-rules-body h4, .kc-rules-body h5 { margin: 10px 0 4px; }
          .kc-rules-body p { margin: 6px 0; }
          .kc-rules-body ul { margin: 4px 0; padding-left: 20px; }
          .kc-rules-body li { margin: 2px 0; }
        </style>
        <ha-card>
          <details ${collapsed ? "" : "open"}>
            <summary>${escapeAttr(title)}</summary>
            <div class="kc-rules-body">${renderRulesMarkdown(rules)}</div>
          </details>
        </ha-card>
      `;
    }
  }

  class KidsCreditsRulesCardEditor extends HTMLElement {
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
    }

    _update(patch) {
      this._config = { ...this._config, ...patch };
      fireConfigChanged(this, this._config);
    }

    _render() {
      this.shadowRoot.innerHTML = css`
        <style>
          ${EDITOR_STYLE}
          textarea {
            width: 100%; min-height: 160px; padding: 8px; border-radius: 6px; border: 1px solid var(--divider-color);
            background: var(--card-background-color); color: var(--primary-text-color); font-family: inherit; box-sizing: border-box;
          }
        </style>
        <div class="kce-field">
          <label>Titel</label>
          <input type="text" id="rc-title" value="${escapeAttr(this._config.title || "Spelregels")}" />
        </div>
        <div class="kce-field">
          <label><input type="checkbox" id="rc-collapsed" ${this._config.collapsed !== false ? "checked" : ""} /> Standaard ingeklapt</label>
        </div>
        <div class="kce-field">
          <label>Regels (markdown: # kop, - lijst, **vet**)</label>
          <textarea id="rc-rules">${escapeAttr(this._config.rules || DEFAULT_RULES)}</textarea>
        </div>
      `;
      this.shadowRoot.querySelector("#rc-title").addEventListener("change", (e) => this._update({ title: e.target.value }));
      this.shadowRoot.querySelector("#rc-collapsed").addEventListener("change", (e) => this._update({ collapsed: e.target.checked }));
      this.shadowRoot.querySelector("#rc-rules").addEventListener("change", (e) => this._update({ rules: e.target.value }));
    }
  }

  customElements.define("kids-credits-parent-card", KidsCreditsParentCard);
  customElements.define("kids-credits-kids-card", KidsCreditsKidsCard);
  customElements.define("kids-credits-parent-card-editor", KidsCreditsParentCardEditor);
  customElements.define("kids-credits-kids-card-editor", KidsCreditsKidsCardEditor);
  customElements.define("kids-credits-rules-card", KidsCreditsRulesCard);
  customElements.define("kids-credits-rules-card-editor", KidsCreditsRulesCardEditor);

  window.customCards = window.customCards || [];
  window.customCards.push(
    {
      type: "kids-credits-parent-card",
      name: "Kids Credits - Ouder",
      description: "Een kaart voor één kind en één ouder: credits toekennen/afnemen, taken en beloningen.",
    },
    {
      type: "kids-credits-kids-card",
      name: "Kids Credits - Kinderen",
      description: "Alleen-lezen overzicht van de credits per kind, voor een gedeeld dashboard.",
    },
    {
      type: "kids-credits-rules-card",
      name: "Kids Credits - Spelregels",
      description: "In-/uitklapbare kaart met de huisregels voor het credit-systeem.",
    }
  );
})();
