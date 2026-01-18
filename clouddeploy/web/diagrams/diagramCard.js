// Renders a Diagram card in the chat feed.
// Depends on CloudDeployMermaidRenderer and CloudDeployDiagramState.

(() => {
  function createButton(label, onClick, extraClasses = "") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.className =
      "px-3 py-1.5 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-sm " +
      extraClasses;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function renderDiagramCard(diagramObj, opts = {}) {
    const feed = document.querySelector("#aiFeed");
    if (!feed) return;

    // Persist last diagram for follow-up edits
    if (window.CloudDeployDiagramState) {
      window.CloudDeployDiagramState.set(diagramObj);
    }

    const card = document.createElement("div");
    card.className = "rounded-lg border border-gray-200 p-3 bg-white text-gray-800";

    const header = document.createElement("div");
    header.className = "flex items-start justify-between gap-3";

    const title = document.createElement("div");
    title.className = "font-semibold text-gray-900";
    title.textContent = diagramObj.title || "Diagram";

    const btnRow = document.createElement("div");
    btnRow.className = "flex items-center gap-2 flex-wrap";

    const previewBtn = createButton("Preview", () => setTab("preview"));
    const codeBtn = createButton("Code", () => setTab("code"));
    btnRow.appendChild(previewBtn);
    btnRow.appendChild(codeBtn);

    header.appendChild(title);
    header.appendChild(btnRow);
    card.appendChild(header);

    if (diagramObj.summary_markdown) {
      const summary = document.createElement("div");
      summary.className = "mt-2 text-sm text-gray-700";
      summary.textContent = diagramObj.summary_markdown;
      card.appendChild(summary);
    }

    const body = document.createElement("div");
    body.className = "mt-3";
    card.appendChild(body);

    const preview = document.createElement("div");
    preview.className = "diagram-preview border border-gray-200 rounded-md p-2 overflow-auto";
    preview.style.maxHeight = "420px";

    const codePanel = document.createElement("div");
    const textarea = document.createElement("textarea");
    textarea.className =
      "w-full min-h-[220px] font-mono text-xs border border-gray-200 rounded-md p-2";
    textarea.value = diagramObj.code || "";
    codePanel.appendChild(textarea);

    const actions = document.createElement("div");
    actions.className = "mt-2 flex items-center gap-2 flex-wrap";

    actions.appendChild(
      createButton("Copy code", async () => {
        try {
          await navigator.clipboard.writeText(textarea.value || "");
        } catch (e) {
          console.warn("Clipboard failed", e);
        }
      })
    );

    actions.appendChild(
      createButton("Edit with prompt", () => {
        const instruction = window.prompt("What should I change in the diagram?");
        if (!instruction) return;
        if (typeof opts.onEdit === "function") {
          opts.onEdit({ instruction, prior_code: textarea.value, diagram: diagramObj });
        }
      })
    );

    actions.appendChild(
      createButton("Open in Composer", () => {
        if (typeof opts.onOpenComposer === "function") {
          opts.onOpenComposer({ diagram: diagramObj, code: textarea.value });
        }
      })
    );

    codePanel.appendChild(actions);

    body.appendChild(preview);
    body.appendChild(codePanel);

    function setTab(name) {
      const isPreview = name === "preview";
      preview.style.display = isPreview ? "block" : "none";
      codePanel.style.display = isPreview ? "none" : "block";

      previewBtn.classList.toggle("bg-gray-900", isPreview);
      previewBtn.classList.toggle("text-white", isPreview);
      codeBtn.classList.toggle("bg-gray-900", !isPreview);
      codeBtn.classList.toggle("text-white", !isPreview);

      if (isPreview && window.CloudDeployMermaidRenderer) {
        window.CloudDeployMermaidRenderer.renderInto(preview, textarea.value);
      }
    }

    setTab("preview");

    feed.appendChild(card);
    feed.scrollTop = feed.scrollHeight;
  }

  window.CloudDeployDiagramCard = { renderDiagramCard };
})();
