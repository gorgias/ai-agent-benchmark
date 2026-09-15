/* Rubric PDF gate. Unlocked when utm_source=email_campaign, or after HubSpot submit. */
(function () {
  const KEY = "rubricDownload";
  const HS_SRC = "https://js.hsforms.net/forms/embed/v2.js";
  const HS = {
    region: "na1",
    portalId: "1725341",
    formId: "6e60d138-4291-46a2-804d-af7fa4ab6f1c",
  };
  const params = new URLSearchParams(location.search);
  const fromEmail = params.get("utm_source") === "email_campaign";
  const unlocked = fromEmail || sessionStorage.getItem(KEY) === "1";

  function apply(on) {
    document.querySelectorAll("[data-rubric-file]").forEach((el) => { el.hidden = !on; });
    document.querySelectorAll("[data-rubric-gate]").forEach((el) => { el.hidden = on; });
  }

  function unlock() {
    sessionStorage.setItem(KEY, "1");
    apply(true);
  }

  apply(unlocked);
  if (unlocked) return;

  const targets = [
    { selector: "#hs-form-hero", instanceId: "rubric-hero" },
    { selector: "#hs-form-cta", instanceId: "rubric-cta" },
    { selector: "#hs-form-report-cta", instanceId: "rubric-report" },
  ].filter((t) => document.querySelector(t.selector));
  if (!targets.length) return;

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
        onFormReady: function ($form) {
          const root = $form && $form.jquery ? $form.get(0) : $form;
          if (!root) return;
          root.querySelectorAll("input.hs-button, .hs-button, .hs-submit input[type='submit']").forEach(function (btn) {
            if (btn.tagName === "INPUT") btn.value = "Download";
            else btn.textContent = "Download";
          });
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
