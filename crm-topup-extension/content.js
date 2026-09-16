// ============================================================
//  CRM Top-Up Helper — content script
//  Two modes, both started from our admin dashboard:
//    #crmlearn=<token>&api=<base>  → teach the helper this CRM
//    #crmtopup=<token>&api=<base>  → run one top-up request
//  Nothing is guessed silently: if a learned element cannot be
//  found, the helper stops and asks for Setup again.
// ============================================================
(() => {
  if (window.__CRM_TOPUP_HELPER__) return;
  window.__CRM_TOPUP_HELPER__ = true;

  const SS_KEY = "__crm_topup_session__";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- session (survives CRM page navigation) ----------
  function loadSession() {
    try {
      return JSON.parse(sessionStorage.getItem(SS_KEY) || "null");
    } catch {
      return null;
    }
  }
  function saveSession(s) {
    try {
      sessionStorage.setItem(SS_KEY, JSON.stringify(s));
    } catch {}
  }
  function clearSession() {
    try {
      sessionStorage.removeItem(SS_KEY);
    } catch {}
  }

  function readHash() {
    const h = location.hash.replace(/^#/, "");
    if (!h) return null;
    const p = new URLSearchParams(h);
    const api = p.get("api");
    if (p.get("crmlearn")) return { mode: "learn", token: p.get("crmlearn"), api };
    if (p.get("crmtopup")) return { mode: "topup", token: p.get("crmtopup"), api };
    return null;
  }

  const fromHash = readHash();
  let session = loadSession();
  if (fromHash) {
    session = {
      mode: fromHash.mode,
      token: fromHash.token,
      api: fromHash.api || (session && session.api) || "",
      step: fromHash.mode === "learn" ? 0 : "start",
      selectors: {},
      startedAt: Date.now(),
    };
    saveSession(session);
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch {}
  }
  if (!session) return;
  if (Date.now() - (session.startedAt || 0) > 24 * 60 * 60 * 1000) {
    clearSession();
    return;
  }


  // ---------- API ----------
  async function api(action, extra) {
    const res = await fetch(session.api, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.assign({ action, token: session.token }, extra || {})),
    });
    return res.json();
  }

  // The dashboard approves the request the moment Approve & Top-Up is clicked,
  // so the helper never reports back to the server — it only shows the outcome.

  // ---------- local fallback store (works even if the link expired) ----------
  const LOCAL_KEY = "crmLayout:" + location.host;
  function saveLocalConfig(selectors) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [LOCAL_KEY]: { selectors, savedAt: Date.now() } }, resolve);
      } catch {
        resolve();
      }
    });
  }
  function loadLocalConfig() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([LOCAL_KEY], (r) => resolve((r && r[LOCAL_KEY]) || null));
      } catch {
        resolve(null);
      }
    });
  }


  // ---------- UI panel ----------
  let panel, panelBody, panelActions;
  function ui() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.style.cssText =
      "position:fixed;z-index:2147483647;right:16px;bottom:16px;width:330px;background:#0f172a;color:#f8fafc;" +
      "font:13px/1.5 system-ui,sans-serif;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.45);overflow:hidden";
    const head = document.createElement("div");
    head.style.cssText = "padding:10px 12px;background:#1e293b;font-weight:600;display:flex;justify-content:space-between";
    head.innerHTML = "<span>CRM Top-Up Helper</span>";
    const close = document.createElement("span");
    close.textContent = "\u2715";
    close.style.cssText = "cursor:pointer;opacity:.6";
    close.onclick = () => {
      clearSession();
      panel.remove();
      panel = null;
    };
    head.appendChild(close);
    panelBody = document.createElement("div");
    panelBody.style.cssText = "padding:12px";
    panelActions = document.createElement("div");
    panelActions.style.cssText = "padding:0 12px 12px;display:flex;gap:8px;flex-wrap:wrap";
    panel.append(head, panelBody, panelActions);
    document.documentElement.appendChild(panel);
    return panel;
  }
  function say(html, actions) {
    ui();
    panelBody.innerHTML = html;
    panelActions.innerHTML = "";
    (actions || []).forEach(({ label, onClick, primary }) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText =
        "flex:1;min-width:100px;padding:8px 10px;border:0;border-radius:8px;cursor:pointer;font-weight:600;" +
        (primary ? "background:#f59e0b;color:#0f172a" : "background:#334155;color:#e2e8f0");
      b.onclick = onClick;
      panelActions.appendChild(b);
    });
  }

  // ---------- element descriptors ----------
  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let sel = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift("#" + CSS.escape(node.id));
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (same.length > 1) sel += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(sel);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function describe(el) {
    const txt = (el.innerText || el.value || "").trim().slice(0, 60);
    const row = el.closest("tr,li,[class*='row'],[class*='card']");
    const rowControls = row ? candidates(row, "button,a,[role='button']") : [];
    const controlIndex = rowControls.indexOf(el);
    const icon = el.querySelector("svg,i,[class*='icon'],[class*='fa-']");
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      name: el.getAttribute("name") || null,
      type: el.getAttribute("type") || null,
      title: el.getAttribute("title") || null,
      placeholder: el.getAttribute("placeholder") || null,
      aria: el.getAttribute("aria-label") || null,
      text: txt || null,
      cls: (el.className && typeof el.className === "string" ? el.className : "").slice(0, 160) || null,
      iconCls:
        icon && icon.className
          ? String(typeof icon.className === "string" ? icon.className : icon.className.baseVal || "").slice(0, 160) || null
          : null,
      controlIndex: controlIndex >= 0 ? controlIndex : null,
      path: cssPath(el),
    };
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  function candidates(root, tag) {
    return Array.from((root || document).querySelectorAll(tag || "*")).filter(visible);
  }

  // Find an element from a learned descriptor, most reliable signal first.
  function find(desc, root) {
    if (!desc) return null;
    const scope = root || document;
    if (desc.id) {
      const el = document.getElementById(desc.id);
      if (visible(el)) return el;
    }
    if (desc.name) {
      const el = scope.querySelector("[name='" + CSS.escape(desc.name) + "']");
      if (visible(el)) return el;
    }
    if (desc.title) {
      const el = scope.querySelector("[title='" + CSS.escape(desc.title) + "']");
      if (visible(el)) return el;
    }
    if (desc.path && !root) {
      try {
        const el = document.querySelector(desc.path);
        if (visible(el) && el.tagName.toLowerCase() === desc.tag) return el;
      } catch {}
    }
    if (desc.placeholder) {
      const el = scope.querySelector("[placeholder='" + CSS.escape(desc.placeholder) + "']");
      if (visible(el)) return el;
    }
    if (desc.aria) {
      const el = scope.querySelector("[aria-label='" + CSS.escape(desc.aria) + "']");
      if (visible(el)) return el;
    }
    if (desc.text) {
      const wanted = desc.text.toLowerCase();
      const el = candidates(scope, desc.tag + ",button,a,[role='button']").find(
        (c) => {
          const actual = (c.innerText || "").trim().toLowerCase();
          return actual === wanted || (wanted.length >= 4 && actual.includes(wanted));
        }
      );
      if (el) return el;
    }
    // Icon-only action buttons (such as Admiki's blue +) have no readable
    // text. Remember their position within the account row and icon class.
    if (root && Number.isInteger(desc.controlIndex)) {
      const controls = candidates(scope, "button,a,[role='button']");
      const el = controls[desc.controlIndex];
      if (el && (!desc.tag || el.tagName.toLowerCase() === desc.tag)) return el;
    }
    if (desc.iconCls) {
      const wanted = desc.iconCls.split(/\s+/).filter(Boolean);
      const el = candidates(scope, "button,a,[role='button']").find((control) => {
        const icon = control.querySelector("svg,i,[class*='icon'],[class*='fa-']");
        const iconClass = icon && icon.className
          ? String(typeof icon.className === "string" ? icon.className : icon.className.baseVal || "")
          : "";
        return wanted.some((token) => token.length > 2 && iconClass.split(/\s+/).includes(token));
      });
      if (el) return el;
    }
    return null;
  }

  // Generic fallbacks (used only when the learned descriptor fails).
  const TOPUP_RE = /(top\s*up|topup|deposit|add\s*fund|add\s*balance|recharge|balance\s*add|credit|increase)/i;
  function fallbackTopUpButton(scope) {
    return candidates(scope, "button,a,[role='button']").find((c) => {
      const icon = c.querySelector("svg,i,[class*='icon'],[class*='fa-']");
      const signal = [
        c.innerText,
        c.getAttribute("title"),
        c.getAttribute("aria-label"),
        c.className,
        icon && (typeof icon.className === "string" ? icon.className : icon.className.baseVal),
      ]
        .filter(Boolean)
        .join(" ");
      return TOPUP_RE.test(signal) || /(^|[\s_-])(plus|add|increase)([\s_-]|$)/i.test(signal);
    });
  }
  function fallbackAmountInput(scope) {
    return (
      candidates(scope, "input").find((i) => i.type === "number") ||
      candidates(scope, "input").find((i) => /amount|dollar|usd|\$/i.test((i.name || "") + (i.placeholder || "") + (i.id || "")))
    );
  }
  function fallbackSearchInput() {
    return (
      candidates(document, "input").find((i) => /search|account/i.test((i.placeholder || "") + (i.name || "") + (i.getAttribute("aria-label") || ""))) ||
      candidates(document, "input[type='search']")[0]
    );
  }
  function fallbackSubmit(scope) {
    return (
      candidates(scope, "button[type='submit'],input[type='submit']")[0] ||
      candidates(scope, "button").find((b) =>
        /(submit|confirm|save|top\s*up|deposit|pay|increase\s*spend\s*cap)/i.test(b.innerText || "")
      )
    );
  }

  // The top-up form must already know which ad account it belongs to before we
  // submit. Some CRMs load the account id / name into the form a moment after
  // the modal opens; submitting too early sends an empty id.
  function formIdentityReady(scope, accountId) {
    const inputs = Array.from(scope.querySelectorAll("input,select,textarea"));
    const idFields = inputs.filter((i) =>
      /(account|act[_-]?id|adaccount|spend)/i.test((i.name || "") + " " + (i.id || "") + " " + (i.getAttribute("data-name") || ""))
    );
    const filled = idFields.some((i) => String(i.value || "").trim().length > 0);
    const shownText = (scope.innerText || "") + " " + inputs.map((i) => i.value || "").join(" ");
    const hasAccount = shownText.includes(String(accountId)) || filled;
    const noEmptyHidden = !inputs.some(
      (i) => i.type === "hidden" && /(account|act[_-]?id|adaccount)/i.test((i.name || "") + (i.id || "")) && !String(i.value || "").trim()
    );
    return hasAccount && noEmptyHidden ? true : null;
  }



  function setValue(el, value) {
    el.focus();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function waitFor(fn, timeout = 15000, every = 400) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(every);
    }
    return null;
  }

  // =====================  LEARN MODE  =====================
  const LEARN_STEPS = [
    { key: "search", label: "অ্যাকাউন্ট সার্চ করার ঘরে ক্লিক করুন", block: true },
    { key: "topupButton", label: "একটা অ্যাকাউন্টের Top-Up বাটনে ক্লিক করুন (ফর্মটা খুলতে দিন)", block: false },
    { key: "amountInput", label: "অ্যামাউন্ট লেখার ঘরে ক্লিক করুন", block: true },
    { key: "submitButton", label: "Increase Spend Cap বাটনে ক্লিক করুন—confirmation box খুলবে, এখনো টাকা যাবে না", block: false },
    { key: "confirmButton", label: "কনফার্ম বক্সের 'Yes, increase it!' বাটনে একবার ক্লিক করুন—Helper final submit আটকাবে", block: true, optional: true },
    { key: "successIndicator", label: "সফল হলে যে মেসেজ দেখা যায় সেখানে ক্লিক করুন (না থাকলে Skip)", block: true, optional: true },

  ];

  function renderLearn() {
    const step = LEARN_STEPS[session.step];
    if (!step) {
      say("সব শেখা শেষ। সেভ করছি…");
      const selectors = session.selectors;
      saveLocalConfig(selectors).then(() =>
        api("save_config", { selectors, name: location.host })
          .catch(() => null)
          .then((r) => {
            if (r && r.ok) {
              say("<b>Setup সম্পন্ন!</b><br>এই CRM-এর জন্য আর সেটআপ লাগবে না।", [
                { label: "বন্ধ করুন", onClick: () => (clearSession(), panel.remove()) },
              ]);
            } else {
              say(
                "<b>Setup এই ব্রাউজারে সেভ হয়েছে</b> — টপ-আপ কাজ করবে।<br>সার্ভারে সেভ হয়নি: " +
                  ((r && r.error) || "connection failed") +
                  "<br>অন্য কম্পিউটারেও লাগলে ড্যাশবোর্ড থেকে আবার Teach চাপুন।",
                [{ label: "বন্ধ করুন", onClick: () => (clearSession(), panel.remove()) }]
              );
            }
          })
      );
      return;
    }
    say(
      "<b>Setup " + (session.step + 1) + "/" + LEARN_STEPS.length + "</b><br>" + step.label,
      step.optional
        ? [{ label: "Skip", onClick: () => (session.step++, saveSession(session), renderLearn()) }]
        : []
    );
  }

  function learnClickHandler(e) {
    const step = LEARN_STEPS[session.step];
    if (!step) return;
    const raw = e.target.closest("input,textarea,select,button,a,[role='button'],span,div");
    const el = raw && (raw.closest("button,a,[role='button']") || raw);
    if (!el || panel.contains(el)) return;
    if (step.block) {
      e.preventDefault();
      e.stopPropagation();
    }
    session.selectors[step.key] = describe(el);
    session.step++;
    saveSession(session);
    setTimeout(renderLearn, 50);
  }

  // =====================  TOP-UP MODE  =====================
  async function reportFailure(msg) {
    say("<b style='color:#fca5a5'>থেমে গেছে</b><br>" + msg + "<br><br>রিকোয়েস্টটি approve হয়ে গেছে — টপ-আপ হাতে করে দিন বা Setup আবার চালান।", [
      { label: "আবার চেষ্টা", onClick: () => runTopUp(true), primary: true },
    ]);
  }

  async function runTopUp(restart) {
    const info = await api("get_config").catch(() => null);
    if (!info || !info.ok) {
      say(
        "লিংক ব্যবহার করা যাচ্ছে না: " +
          ((info && info.error) || "connection failed") +
          "<br>ড্যাশবোর্ড থেকে আবার Approve & Top-Up চাপুন।"
      );
      return;
    }
    const job = info.job;
    const cfg = info.config || {};
    let sel = cfg.selectors || {};
    if (!sel.amountInput || !sel.topupButton) {
      const local = await loadLocalConfig();
      if (local && local.selectors) sel = local.selectors;
    }
    if (!job) {
      say("এই লিংকে কোনো টপ-আপ রিকোয়েস্ট নেই।");
      return;
    }
    session.job = job;
    session.autoConfirm = !!cfg.auto_confirm;
    saveSession(session);

    if (!sel.amountInput || !sel.topupButton) {
      say(
        "এই CRM-এর জন্য এখনো Setup করা হয়নি।<br>ড্যাশবোর্ড থেকে <b>Teach helper</b> চাপুন।"
      );
      return;
    }

    say(
      "অ্যাকাউন্ট <b>" + job.accountId + "</b><br>অ্যামাউন্ট <b>$" + job.amount + "</b><br>খুঁজছি…"
    );

    // 1) search the account
    const search = find(sel.search) || fallbackSearchInput();
    if (search) {
      setValue(search, job.accountId);
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
      search.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", keyCode: 13, bubbles: true }));
      const form = search.closest("form");
      if (form && form.requestSubmit) {
        try {
          form.requestSubmit();
        } catch {}
      }
      await sleep(1500);
    }

    // 2) find the row that shows this account id, then its top-up button
    const row = await waitFor(() => {
      const cells = Array.from(document.querySelectorAll("tr,li,[class*='row'],[class*='card']"));
      return cells.find((c) => visible(c) && (c.innerText || "").includes(job.accountId));
    }, 12000);
    if (!row) {
      await reportFailure("অ্যাকাউন্ট " + job.accountId + " CRM-এর লিস্টে খুঁজে পাইনি।");
      return;
    }
    const btn = find(sel.topupButton, row) || fallbackTopUpButton(row);
    if (!btn) {
      await reportFailure("ওই অ্যাকাউন্টের Top-Up বাটন চিনতে পারিনি। Setup আবার চালান।");
      return;
    }
    btn.click();

    // 3) amount field
    const amountEl = await waitFor(() => find(sel.amountInput) || fallbackAmountInput(document), 12000);
    if (!amountEl) {
      await reportFailure("টপ-আপ ফর্মের অ্যামাউন্টের ঘর খুঁজে পাইনি।");
      return;
    }
    // The CRM fills the account id into the form after the modal opens. Submitting
    // before that happens produces "route .../ad-account//-spend-cap not found".
    const modalScope =
      amountEl.closest(
        "form,[role='dialog'],[role='alertdialog'],.modal,[class*='modal'],[class*='dialog'],[class*='popup'],[class*='drawer']"
      ) || document;
    const ready = await waitFor(() => formIdentityReady(modalScope, job.accountId), 12000, 300);
    if (!ready) {
      await reportFailure("টপ-আপ ফর্মে অ্যাকাউন্টের তথ্য বসেনি — আবার চেষ্টা করুন।");
      return;
    }
    await sleep(900);
    setValue(amountEl, job.amount);
    await sleep(700);


    // 4) verify before submitting
    const typed = Number(String(amountEl.value).replace(/[^0-9.]/g, ""));
    if (!(Math.abs(typed - Number(job.amount)) < 0.005)) {
      await reportFailure("অ্যামাউন্ট ঠিকভাবে বসেনি (ফর্মে: " + amountEl.value + ")।");
      return;
    }
    const formScope =
      amountEl.closest(
        "form,[role='dialog'],[role='alertdialog'],.modal,[class*='modal'],[class*='dialog'],[class*='popup'],[class*='drawer']"
      ) || document;
    if (!(document.body.innerText || "").includes(job.accountId)) {
      await reportFailure("ফর্মে অ্যাকাউন্ট ID মিলছে না — নিরাপত্তার জন্য থেমে গেছি।");
      return;
    }

    const submit = find(sel.submitButton, formScope) || fallbackSubmit(formScope);
    if (!submit) {
      await reportFailure("Submit বাটন খুঁজে পাইনি।");
      return;
    }

    const doSubmit = async () => {
      say("সাবমিট করছি…");

      submit.click();

      // Second confirmation dialog (e.g. "Are you sure you want to increase spend cap by 8?")
      const confirmEl = await waitFor(() => {
        const learned = sel.confirmButton ? find(sel.confirmButton) : null;
        if (learned && learned.offsetParent !== null && learned !== submit) return learned;
        const dialogs = candidates(
          document,
          ".swal2-popup,.swal-modal,[role='alertdialog'],[role='dialog'],.modal,[class*='modal'],[class*='dialog'],[class*='popup']"
        );
        const dialog = dialogs[dialogs.length - 1] || null;
        const scope = dialog || document;
        const btns = candidates(scope, "button,a,[role='button']");
        return (
          btns.find((b) => /(yes[, ]|yes$|increase it|confirm|নিশ্চিত|হ্যাঁ)/i.test((b.innerText || "").trim())) || null
        );
      }, 6000, 300);
      if (confirmEl) {
        say("কনফার্ম করছি…");
        confirmEl.click();
        await sleep(600);
      }

      const ok = await waitFor(() => {
        const t = document.body.innerText || "";

        if (sel.successIndicator && sel.successIndicator.text && t.includes(sel.successIndicator.text)) return true;
        return /(success|successful|successfully|completed|approved|সফল)/i.test(t) ? true : null;
      }, 20000);
      if (!ok) {
        await reportFailure("সফল হয়েছে কিনা নিশ্চিত হতে পারিনি। CRM-এ চেক করুন।");
        return;
      }
      say("টপ-আপ হয়েছে — রিকোয়েস্ট আপডেট করছি…");
      const r = await reportSuccessWithRetry();
      if (r.ok) {
        say("<b style='color:#86efac'>টপ-আপ সম্পন্ন</b><br>$" + job.amount + " — " + job.accountId + "<br>রিকোয়েস্ট completed হয়ে গেছে।", [
          { label: "বন্ধ করুন", onClick: () => (clearSession(), panel.remove()) },
        ]);
      } else {
        say(
          "<b>CRM-এ টপ-আপ হয়েছে</b>, কিন্তু রিকোয়েস্ট আপডেট হয়নি: " +
            (r.error || "unknown") +
            "<br>চেষ্টা চালু থাকবে। না হলে ড্যাশবোর্ড থেকে <b>Mark completed</b> চাপুন।",
          [
            {
              label: "আবার পাঠান",
              primary: true,
              onClick: async () => {
                const again = await reportSuccessWithRetry();
                say(
                  again.ok
                    ? "<b style='color:#86efac'>রিকোয়েস্ট completed হয়ে গেছে।</b>"
                    : "এখনো হয়নি: " + (again.error || "unknown") + " — ড্যাশবোর্ড থেকে Mark completed করুন।"
                );
              },
            },
            { label: "বন্ধ করুন", onClick: () => (clearSession(), panel.remove()) },
          ]
        );
      }

    };

    if (session.autoConfirm) {
      await doSubmit();
    } else {
      say(
        "সব রেডি — <b>$" + job.amount + "</b>, অ্যাকাউন্ট <b>" + job.accountId + "</b>.<br>মিলিয়ে দেখে Confirm চাপুন।",
        [
          { label: "Confirm & Submit", onClick: doSubmit, primary: true },
          { label: "বাতিল", onClick: () => (clearSession(), panel.remove()) },
        ]
      );
    }
  }

  // =====================  boot  =====================
  if (session.mode === "learn") {
    document.addEventListener("click", learnClickHandler, true);
    renderLearn();
  } else if (session.mode === "topup") {
    if (session.step === "start") {
      session.step = "running";
      saveSession(session);
      runTopUp();
    } else {
      say("আগের টপ-আপ চেষ্টা চলছিল।", [{ label: "আবার চালান", onClick: () => runTopUp(true), primary: true }]);
    }
  }
})();
