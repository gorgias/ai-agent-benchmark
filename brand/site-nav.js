/* Site nav + footer. Canonical routes (no .html): /  /report  /rubric
   How it works always opens the eval modal (openModal from the page or /brand/how-modal.js).
   Mount:
   <nav class="sitenav wrap-x" id="appbar" data-active="overview|results|rubric"></nav>
   <footer class="sitefoot wrap-x"></footer>
   <script src="/brand/how-modal.js"></script>
   <script src="/brand/site-nav.js"></script> */
(function () {
  // Vercel Web Analytics (static HTML). Dashboard must have Analytics enabled; the
  // script is served at /_vercel/insights/script.js after the next production deploy.
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  if (!document.querySelector('script[src="/_vercel/insights/script.js"]')) {
    const s = document.createElement("script");
    s.defer = true;
    s.src = "/_vercel/insights/script.js";
    document.head.appendChild(s);
  }
  function pagePath() {
    return (location.pathname || "/").replace(/index\.html$/, "/").replace(/\.html$/, "") || "/";
  }
  window.vaTrack = function (name, data) {
    if (typeof window.va !== "function" || !name) return;
    const payload = { name: String(name).slice(0, 255) };
    if (data && typeof data === "object") payload.data = data;
    try { window.va("event", payload); } catch (e) {}
  };
  function trackChart(el) {
    if (!el || !el.closest) return;
    if (el.closest(".linklike, .modal-x, a[href='#how']")) return;
    var chart = null, action = "click";
    if (el.closest("#fjb-axiswrap, #ovm-svg")) chart = "overview-axis";
    else if (el.closest(".fjb-btn")) { chart = "overview"; action = "toggle"; }
    else if (el.closest("#fjb-table th.srt")) { chart = "overview-table"; action = "sort"; }
    else if (el.closest("#fjb-table")) chart = "overview-table";
    else if (el.closest(".h2h-tab, .h2h-toggle")) { chart = "head-to-head"; action = "lane"; }
    else if (el.closest("#h2h-svg, .h2h-plot, .h2h-table")) chart = "head-to-head";
    else if (el.closest("#store-filter")) { chart = "speed"; action = "filter"; }
    else if (el.closest("#resp-toggle")) { chart = "speed"; action = "toggle"; }
    else if (el.closest("#latdive, #results-sec .ld-row")) chart = "speed";
    else if (el.closest("#trend-grid, #trend-sec, #trend-leaders")) chart = "trends";
    else if (el.closest("#intent-sec")) chart = "quality-by-intent";
    else if (el.closest("#conv-chart")) chart = "conversations";
    else if (el.closest("#conv-filters")) { chart = "conversations"; action = "filter"; }
    else if (el.closest("#vp-svg")) chart = "volume";
    else if (el.closest("#product-rec-sec")) chart = "product-rec";
    else if (el.closest("#datebar")) { chart = "date-window"; action = "filter"; }
    else if (el.closest("#vf-trigger, #wf-trigger, #vf-pop, #wf-pop, #clear-all-filters")) { chart = "vendor-filter"; action = "filter"; }
    else if (el.closest("#matrix-body")) chart = "capabilities";
    else if (el.closest(".modebtn")) { chart = "lane"; action = "toggle"; }
    if (!chart) return;
    var detail = "";
    var host = el.closest("[data-m], [data-lane], [data-v], [data-k], [data-stat]");
    if (host) detail = host.dataset.m || host.dataset.lane || host.dataset.v || host.dataset.k || host.dataset.stat || "";
    window.vaTrack("Chart", {
      chart: chart,
      action: action,
      page: pagePath(),
      detail: String(detail).slice(0, 255),
    });
  }
  document.addEventListener("click", function (e) {
    const t = e.target && e.target.closest && e.target.closest("a, button, [data-v], svg, th.srt, .ld-row, .qbi-row");
    if (!t || t.disabled) return;
    const page = pagePath();
    const href = t.getAttribute("href") || "";
    if (t.hasAttribute("data-rubric-file")) window.vaTrack("Rubric Download", { page: page, source: "button" });
    else if (t.classList.contains("fjb-btn") && t.dataset.m) window.vaTrack("Overview Toggle", { page: page, view: t.dataset.m });
    else if (t.classList.contains("modebtn") && t.dataset.m) window.vaTrack("Lane Toggle", { page: page, lane: t.dataset.m });
    else if (t.classList.contains("gr-btn") && (href === "/report" || href.endsWith("/report"))) window.vaTrack("Full Results CTA", { page: page });
    else if (t.classList.contains("gr-btn") && (href === "/rubric" || href.endsWith("/rubric"))) window.vaTrack("Rubric CTA", { page: page });
    trackChart(e.target);
  }, true);
  document.addEventListener("change", function (e) {
    const el = e.target;
    if (!el || !el.closest) return;
    if (el.closest("#conv-filters, #vf-pop, #wf-pop, #datebar")) trackChart(el);
  }, true);

  const overview = "/";
  const results = "/report";
  const rubric = "/rubric";
  const howClick = ' href="#how" onclick="openModal();return false;"';
  const nav = document.querySelector("nav.sitenav[data-active]");

  if (nav && nav.getAttribute("data-mounted") !== "1") {
    const active = nav.getAttribute("data-active");
    const mark = function (name) {
      return active === name ? ' class="active" aria-current="page"' : "";
    };
    nav.innerHTML =
      '<div class="brand">' +
        '<a class="mark-link" href="https://www.gorgias.com" target="_blank" rel="noopener noreferrer">' +
          '<img class="mark" src="/brand/gorgias-logo.svg" alt="Gorgias" width="101" height="26">' +
        "</a>" +
        '<a class="sub" href="/">AI Agent Benchmark</a>' +
      "</div>" +
      '<button class="nav-burger" type="button" aria-label="Menu" onclick="event.stopPropagation();this.closest(\'.sitenav\').classList.toggle(\'nav-open\')">☰</button>' +
      '<div class="links">' +
        '<a href="' + overview + '" id="nav-overview"' + mark("overview") + ">Overview</a>" +
        '<a href="' + results + '" id="nav-report"' + mark("results") + ">Full results</a>" +
        '<a href="' + rubric + '" id="nav-rubric"' + mark("rubric") + ">Rubric</a>" +
        "<a" + howClick + mark("how") + ">How it works</a>" +
      "</div>";
    nav.setAttribute("data-mounted", "1");
  }

  function mountFooter() {
    const foot = document.querySelector("footer.sitefoot");
    if (!foot || foot.getAttribute("data-mounted") === "1") return;
    foot.classList.add("wrap-x");
    foot.innerHTML =
      '<p class="fbrand">Gorgias · AI Agent Benchmark</p>' +
      '<div class="flinks">' +
        '<a href="' + overview + '">Overview</a>' +
        '<a href="' + results + '">Full results</a>' +
        '<a href="' + rubric + '">Rubric</a>' +
        "<a" + howClick + ">How it works</a>" +
      "</div>";
    foot.setAttribute("data-mounted", "1");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountFooter);
  else mountFooter();
})();
