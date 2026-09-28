/* MCP server modal, opened by the "MCP" item in the site nav and by any link to #mcp (the /mcp endpoint
   sends browsers to /#mcp). site-nav.js loads this file on first use; the markup is /brand/mcp.html. */
(function () {
  let loading = null, opener = null;
  const page = () => (location.pathname || "/").replace(/\.html$/, "") || "/";

  function load() {
    if (document.getElementById("mcp-modal")) return Promise.resolve(true);
    if (!loading) {
      loading = fetch("/brand/mcp.html")
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then((html) => { document.body.insertAdjacentHTML("beforeend", html); wire(); return true; })
        .catch((err) => { console.warn("MCP modal failed to load", err); loading = null; return false; });
    }
    return loading;
  }

  function wire() {
    const el = document.getElementById("mcp-modal");
    el.addEventListener("click", (e) => {
      if (e.target === el || (e.target.closest && e.target.closest("[data-mcp-close]"))) hide();
    });
    el.querySelectorAll("[data-copy]").forEach((btn) => btn.addEventListener("click", async () => {
      const src = el.querySelector(btn.dataset.copy);
      if (!src) return;
      const label = btn.textContent;
      try { await navigator.clipboard.writeText(src.textContent); btn.textContent = "Copied"; }
      catch (e) { const r = document.createRange(); r.selectNodeContents(src); const s = getSelection(); s.removeAllRanges(); s.addRange(r); btn.textContent = "Selected"; }
      if (window.vaTrack) window.vaTrack("MCP", { action: "copy", page: page(), detail: btn.dataset.copy });
      setTimeout(() => { btn.textContent = label; }, 1600);
    }));
  }

  function show() {
    opener = document.activeElement;
    load().then((ok) => {
      const el = document.getElementById("mcp-modal");
      if (!ok || !el) return;
      if (el.hidden && window.vaTrack) window.vaTrack("MCP", { action: "open", page: page() });
      el.hidden = false;
      document.body.style.overflow = "hidden";
      const x = el.querySelector(".modal-x");
      if (x) x.focus();
    });
  }

  function hide() {
    const el = document.getElementById("mcp-modal");
    if (!el || el.hidden) return;
    el.hidden = true;
    document.body.style.overflow = "";
    if (location.hash === "#mcp") {
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { location.hash = ""; }
    }
    if (opener && opener.focus) opener.focus();
  }

  window.openMcpModal = show;
  window.closeMcpModal = hide;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  window.addEventListener("hashchange", () => { if (location.hash === "#mcp") show(); });
  if (window.__mcpPending || location.hash === "#mcp") { window.__mcpPending = false; show(); }
})();
