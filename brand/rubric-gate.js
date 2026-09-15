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

  function labelButtons(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll("input.hs-button, button.hs-button, .hs-submit input[type='submit'], .hs-submit button, input[type='submit']").forEach(function (btn) {
      if (btn.tagName === "INPUT") {
        if (btn.value !== LABEL) btn.value = LABEL;
      } else if ((btn.textContent || "").trim() !== LABEL) {
        btn.textContent = LABEL;
      }
    });
  }

  function watch(root) {
    if (!root || root.getAttribute("data-rubric-watch") === "1") return;
    root.setAttribute("data-rubric-watch", "1");
    labelButtons(root);
    const mo = new MutationObserver(function () { labelButtons(root); });
    mo.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["value", "class", "disabled"],
    });
    root.addEventListener("submit", function () { labelButtons(root); }, true);
    root.addEventListener("click", function () {
      labelButtons(root);
      setTimeout(function () { labelButtons(root); }, 0);
    }, true);
  }

  function formEl($form) {
    return $form && $form.jquery ? $form.get(0) : $form;
  }

  function createForms() {
    if (!window.hbspt || !window.hbspt.forms) return false;
    targets.forEach((t) => {
      if (document.querySelector(t.selector + " .hbspt-form, " + t.selector + " form")) return;
      window.hbspt.forms.create({
        region: HS.region,
        portalId: HS.portalId,
        formId: HS.formId,
        target: t.selector,
        formInstanceId: t.instanceId,
        submitButtonClass: "hs-button",
        locale: "en",
        translations: {
          en: { submitText: LABEL },
        },
        onFormReady: function ($form) {
          const root = formEl($form);
          if (root) watch(root);
          const mount = document.querySelector(t.selector);
          if (mount) watch(mount);
        },
        onFormSubmit: function ($form) {
          const root = formEl($form);
          if (!root) return;
          labelButtons(root);
          var n = 0;
          var id = setInterval(function () {
            labelButtons(root);
            if (++n > 40) clearInterval(id);
          }, 50);
        },
        onFormSubmitted: function () {
          unlock();
        },
      });
    });
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
})();
