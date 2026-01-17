// Mermaid initialization + safe rendering helpers.
// Requires Mermaid to be loaded globally (window.mermaid).

(() => {
  let initialized = false;

  function initOnce() {
    if (initialized) return;
    if (!window.mermaid) {
      console.warn("Mermaid not loaded. Did you include the Mermaid <script>?");
      return;
    }

    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
    });
    initialized = true;
  }

  async function renderInto(containerEl, code) {
    initOnce();
    if (!window.mermaid || !containerEl) return;

    const src = (code || "").toString();
    if (!src.trim()) {
      containerEl.innerHTML = "<div class='text-gray-500'>No diagram code</div>";
      return;
    }

    const id = "cd_mermaid_" + Math.random().toString(36).slice(2);

    try {
      const out = await window.mermaid.render(id, src);
      containerEl.innerHTML = out.svg;
    } catch (e) {
      console.error("Mermaid render error", e);
      containerEl.innerHTML =
        "<div class='text-red-600 font-medium'>Diagram render error</div>" +
        "<pre class='mt-2 text-xs whitespace-pre-wrap bg-red-50 p-2 rounded'>" +
        (e?.message || String(e)) +
        "</pre>";
    }
  }

  window.CloudDeployMermaidRenderer = {
    initOnce,
    renderInto,
  };
})();
