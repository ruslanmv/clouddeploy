(() => {
  function injectApproveButton(cardEl, diagramObj) {
    if (!cardEl || !diagramObj) return;
    if (!window.CloudDeployWorkflow) return;

    const actions = cardEl.querySelector("div.mt-2.flex");
    if (!actions) return;

    // Avoid duplicates
    if (actions.querySelector("[data-cd-approve-diagram]")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Approve diagram";
    btn.dataset.cdApproveDiagram = "1";
    btn.className =
      "px-3 py-1.5 rounded-md border border-gray-900 bg-gray-900 text-white hover:opacity-95 text-sm";

    btn.addEventListener("click", () => {
      window.CloudDeployWorkflow.approveDiagram(diagramObj);
      alert("Diagram approved. Next step: generate the plan.");
    });

    actions.appendChild(btn);
  }

  // Hook into existing renderer by monkey-patching renderDiagramCard if present
  const poll = setInterval(() => {
    const api = window.CloudDeployDiagramCard;
    if (!api?.renderDiagramCard) return;

    clearInterval(poll);

    const original = api.renderDiagramCard;
    api.renderDiagramCard = function patched(diagramObj, opts) {
      original(diagramObj, opts);

      // Last card inserted is the last element in aiFeed
      const feed = document.querySelector("#aiFeed");
      const cardEl = feed?.lastElementChild;
      injectApproveButton(cardEl, diagramObj);
    };
  }, 50);
})();
