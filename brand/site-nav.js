/* Site nav + footer — Figma Takeaways Nav (4015:1940) / Footer (4025:1954).
   Mount:
   <nav class="sitenav wrap-x" id="appbar" data-active="overview|results|rubric" data-how="anchor|modal"></nav>
   <footer class="sitefoot wrap-x"></footer>
   <script src="/brand/site-nav.js"></script>
   Page supplies data-active / data-how only. Labels and destinations are the component. */
(function () {
  const overview = "takeaways-v2.html";
  const results = "report-v2.html";
  const rubric = "rubric.html";
  const nav = document.querySelector("nav.sitenav[data-active]");
  const howMode = (nav && nav.getAttribute("data-how")) || "anchor";
  const howAttrsNav =
    howMode === "modal"
      ? ' href="#how" onclick="openModal();return false;"'
      : howMode === "overview"
        ? ' href="' + overview + '#how"'
        : ' href="#how"';

  if (nav && nav.getAttribute("data-mounted") !== "1") {
    const active = nav.getAttribute("data-active");
    const mark = function (name) {
      return active === name ? ' class="active" aria-current="page"' : "";
    };
    nav.innerHTML =
      '<a class="brand" href="' + overview + '">' +
        '<img class="mark" src="/brand/gorgias-logo.svg" alt="Gorgias" width="101" height="26">' +
        '<span class="sub">AI Agent Benchmark</span>' +
      "</a>" +
      '<button class="nav-burger" type="button" aria-label="Menu" onclick="event.stopPropagation();this.closest(\'.sitenav\').classList.toggle(\'nav-open\')">☰</button>' +
      '<div class="links">' +
        '<a href="' + overview + '" id="nav-overview"' + mark("overview") + ">Overview</a>" +
        '<a href="' + results + '" id="nav-report"' + mark("results") + ">Full results</a>" +
        "<a" + howAttrsNav + mark("how") + ">How it works</a>" +
        '<a href="' + rubric + '" id="nav-rubric"' +
          mark("rubric") + ">Rubric</a>" +
      "</div>";
    nav.setAttribute("data-mounted", "1");
  }

  function howAttrsFoot() {
    if (howMode === "modal") return ' href="#how" onclick="openModal();return false;"';
    if (document.getElementById("how")) return ' href="#how"';
    return ' href="' + overview + '#how"';
  }

  function mountFooter() {
    const foot = document.querySelector("footer.sitefoot");
    if (!foot || foot.getAttribute("data-mounted") === "1") return;
    foot.classList.add("wrap-x");
    foot.innerHTML =
      '<p class="fbrand">Gorgias · AI Agent Benchmark</p>' +
      '<div class="flinks">' +
        '<a href="' + results + '">Full results</a>' +
        "<a" + howAttrsFoot() + ">How it works</a>" +
        '<a href="' + rubric + '">Rubric</a>' +
      "</div>";
    foot.setAttribute("data-mounted", "1");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountFooter);
  else mountFooter();
})();
