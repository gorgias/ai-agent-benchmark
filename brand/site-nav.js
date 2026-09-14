/* Site nav + footer. Canonical routes (no .html): /takeaways  /report  /rubric
   How it works always opens the eval modal (openModal from the page or /brand/how-modal.js).
   Mount:
   <nav class="sitenav wrap-x" id="appbar" data-active="overview|results|rubric"></nav>
   <footer class="sitefoot wrap-x"></footer>
   <script src="/brand/how-modal.js"></script>
   <script src="/brand/site-nav.js"></script> */
(function () {
  const overview = "/takeaways";
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
