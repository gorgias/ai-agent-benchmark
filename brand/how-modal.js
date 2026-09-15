/* Shared How-it-works modal. Report pages already inline #howto; Overview and Rubric
   fetch /brand/howto.html (extracted from the report modal so the copy stays one source). */
(function () {
  function show() {
    const el = document.getElementById("howto");
    if (!el) return false;
    if (el.hidden && window.vaTrack) {
      window.vaTrack("How It Works", { page: (location.pathname || "/").replace(/\.html$/, "") || "/" });
    }
    el.hidden = false;
    document.body.style.overflow = "hidden";
    return true;
  }
  function hide() {
    const el = document.getElementById("howto");
    if (!el) return;
    el.hidden = true;
    document.body.style.overflow = "";
    if (location.hash === "#how") {
      try { history.replaceState(null, "", location.pathname + location.search); }
      catch (e) { location.hash = ""; }
    }
  }

  window.openModal = function () {
    if (!show()) window.__howPending = true;
  };
  window.closeModal = hide;
  window.setMTab = function (t) {
    document.querySelectorAll("#mtabs .tab").forEach((b) => b.setAttribute("aria-selected", b.dataset.mt === t));
    document.querySelectorAll(".mtab").forEach((p) => { p.hidden = p.dataset.mtp !== t; });
    if (t === "volume" && typeof window.renderVolPie === "function") window.renderVolPie();
    if (window.vaTrack) window.vaTrack("Chart", { chart: "how-it-works", action: "tab", page: (location.pathname || "/").replace(/\.html$/, "") || "/", detail: String(t || "") });
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });

  function ready() {
    if (window.__howPending || location.hash === "#how") show();
  }

  if (!document.getElementById("howto")) {
    fetch("/brand/howto.html")
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then((html) => {
        document.body.insertAdjacentHTML("beforeend", html);
        ready();
      })
      .catch((err) => console.warn("How it works modal failed to load", err));
  } else {
    ready();
  }
})();
