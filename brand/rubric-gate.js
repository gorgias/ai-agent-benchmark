/* Rubric PDF gate. Unlocked when utm_source=email_campaign, or after HubSpot submit. */
(function () {
  const KEY = "rubricDownload";
  const LABEL = "Download";
  const HS_SRC = "https://js.hsforms.net/forms/embed/v2.js";
  const HS = {
    region: "na1",
    portalId: "1725341",
    formId: "6e60d138-4291-46a2-804d-af7fa4ab6f1c",
  };
  const params = new URLSearchParams(location.search);
  const fromEmail = params.get("utm_source") === "email_campaign";
  const submitted = sessionStorage.getItem(KEY) === "1";

  function apply(unlocked, thanks) {
    document.querySelectorAll("[data-rubric-file]").forEach((el) => { el.hidden = !unlocked; });
    document.querySelectorAll("[data-rubric-form]").forEach((el) => { el.hidden = unlocked; });
    document.querySelectorAll("[data-rubric-thanks]").forEach((el) => { el.hidden = !thanks; });
  }

  function startDownload() {
    const a = document.querySelector("a[data-rubric-file]");
    if (a) a.click();
  }

  function unlock() {
    sessionStorage.setItem(KEY, "1");
    apply(true, true);
    startDownload();
  }

  apply(fromEmail || submitted, submitted && !fromEmail);
  if (fromEmail || submitted) return;

  const targets = [
    { selector: "#hs-form-hero", instanceId: "rubric-hero" },
    { selector: "#hs-form-cta", instanceId: "rubric-cta" },
    { selector: "#hs-form-report-cta", instanceId: "rubric-report" },
  ].filter((t) => document.querySelector(t.selector));
  if (!targets.length) return;

  function hsSubmit(root) {
    if (!root || !root.querySelector) return null;
    return root.querySelector("input[type='submit'], button[type='submit'], input.hs-button, button.hs-button");
  }

  function decorate(mount) {
    if (!mount) return;
    const native = hsSubmit(mount);
    if (native) {
      if (native.tagName === "INPUT") native.value = LABEL;
      else native.textContent = LABEL;
      native.setAttribute("value", LABEL);
      native.classList.add("hs-native-submit");
      native.setAttribute("tabindex", "-1");
      native.setAttribute("aria-hidden", "true");
    }
    let fake = mount.querySelector("[data-rubric-dl-btn]");
    if (!fake) {
      fake = document.createElement("button");
      fake.type = "button";
      fake.className = "rubric-dl-btn";
      fake.setAttribute("data-rubric-dl-btn", "");
      fake.textContent = LABEL;
      fake.addEventListener("click", function (e) {
        e.preventDefault();
        const form = mount.querySelector("form");
        const btn = hsSubmit(mount);
        if (form && typeof form.reportValidity === "function" && !form.reportValidity()) return;
        if (btn) btn.click();
        else if (form && typeof form.requestSubmit === "function") form.requestSubmit();
        else if (form) form.submit();
      });
      mount.appendChild(fake);
    }
    fake.textContent = LABEL;
  }

  function decorateAll() {
    targets.forEach(function (t) { decorate(document.querySelector(t.selector)); });
  }

  function formEl($form) {
    return $form && $form.jquery ? $form.get(0) : $form;
  }

  function createForms() {
    if (!window.hbspt || !window.hbspt.forms) return false;
    targets.forEach((t) => {
      if (document.querySelector(t.selector + " .hbspt-form, " + t.selector + " form")) {
        decorate(document.querySelector(t.selector));
        return;
      }
      window.hbspt.forms.create({
        region: HS.region,
        portalId: HS.portalId,
        formId: HS.formId,
        target: t.selector,
        formInstanceId: t.instanceId,
        submitButtonClass: "hs-button hs-native-submit",
        locale: "en",
        translations: { en: { submitText: LABEL } },
        onFormReady: function ($form) {
          decorate(document.querySelector(t.selector));
          const root = formEl($form);
          if (root) decorate(root.closest(".hs-inline-form") || document.querySelector(t.selector));
        },
        onFormSubmit: function () {
          decorateAll();
        },
        onFormSubmitted: function () {
          unlock();
        },
      });
    });
    decorateAll();
    return true;
  }

  function waitForHs(tries) {
    if (createForms()) return;
    if (tries <= 0) return;
    setTimeout(function () { waitForHs(tries - 1); }, 50);
  }

  const existing = document.querySelector('script[src="' + HS_SRC + '"]');
  if (window.hbspt && window.hbspt.forms) {
    createForms();
  } else if (existing) {
    existing.addEventListener("load", function () { waitForHs(40); });
    waitForHs(40);
  } else {
    const s = document.createElement("script");
    s.src = HS_SRC;
    s.async = true;
    s.onload = function () { waitForHs(40); };
    document.head.appendChild(s);
  }

  const mo = new MutationObserver(decorateAll);
  targets.forEach(function (t) {
    const el = document.querySelector(t.selector);
    if (el) mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  setInterval(decorateAll, 400);
})();
