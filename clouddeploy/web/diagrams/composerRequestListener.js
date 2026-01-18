// Parent page listener: receives diagram requests from composer iframe
// Handles: generate, edit, and graph change notifications
// Sends back: apply_composer_graph, set_stage

(() => {
  function normalizePromptToDiagram(prompt) {
    return (
      "MODE: DIAGRAM\n" +
      "OUTPUT: diagram\n" +
      "CLOUD: aws\n\n" +
      "Generate an AWS architecture diagram for this request. " +
      "Return JSON with type=\"diagram\" and a Mermaid architecture-beta diagram with composer_graph.\n\n" +
      "REQUEST:\n" +
      prompt
    );
  }

  function normalizeEditToDiagram(instruction, currentGraph) {
    return (
      "MODE: DIAGRAM\n" +
      "OUTPUT: diagram\n" +
      "CLOUD: aws\n\n" +
      "Edit the existing AWS architecture diagram based on this instruction. " +
      "Return JSON with type=\"diagram\" and the FULL updated Mermaid code with updated composer_graph.\n\n" +
      "CURRENT_GRAPH:\n" +
      JSON.stringify(currentGraph, null, 2) +
      "\n\nEDIT_INSTRUCTION:\n" +
      instruction
    );
  }

  // Handle diagram response and send graph to Composer
  function onDiagramResponse(diagramObj) {
    if (!diagramObj || diagramObj.type !== "diagram") return;

    const frame = document.getElementById("composerFrame");
    if (!frame || !frame.contentWindow) return;

    const graph = diagramObj.composer_graph;
    if (graph) {
      // Send updated graph to Composer
      frame.contentWindow.postMessage(
        {
          type: "clouddeploy:apply_composer_graph",
          graph: graph,
        },
        "*"
      );

      // Store in diagram state for later use
      if (window.CloudDeployDiagramState) {
        window.CloudDeployDiagramState.set(diagramObj);
      }
    }
  }

  // Listen for diagram responses from AI
  if (window.CloudDeployAIWS) {
    const originalOnMessage = window.CloudDeployAIWS.onmessage;
    window.CloudDeployAIWS.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && data.type === "diagram") {
          onDiagramResponse(data);
        }
      } catch (e) {
        // Not JSON or not a diagram response
      }
    });
  }

  // Handle messages from Composer
  window.addEventListener("message", (event) => {
    const msg = event?.data;
    if (!msg) return;

    // 1) Generate new diagram
    if (msg.type === "clouddeploy:request_diagram_generate") {
      const prompt = (msg.prompt || "").toString().trim();
      if (!prompt) return;

      if (typeof window.CloudDeploySendAI !== "function") {
        console.warn("CloudDeploySendAI is not available");
        return;
      }

      // Switch to composer tab to show diagram being generated
      const composerTab = document.querySelector('[data-tab="composer"]');
      composerTab?.click?.();

      window.CloudDeploySendAI(normalizePromptToDiagram(prompt));
      return;
    }

    // 2) Edit existing diagram
    if (msg.type === "clouddeploy:request_diagram_edit") {
      const instruction = (msg.instruction || "").toString().trim();
      const currentGraph = msg.current_graph;

      if (!instruction) return;

      if (typeof window.CloudDeploySendAI !== "function") {
        console.warn("CloudDeploySendAI is not available");
        return;
      }

      // Switch to composer tab
      const composerTab = document.querySelector('[data-tab="composer"]');
      composerTab?.click?.();

      window.CloudDeploySendAI(normalizeEditToDiagram(instruction, currentGraph));
      return;
    }

    // 3) Graph changed notification (optional - for keeping session in sync)
    if (msg.type === "clouddeploy:composer_graph_changed") {
      const graph = msg.graph;
      if (graph && window.CloudDeployDiagramState) {
        const current = window.CloudDeployDiagramState.get() || {};
        current.composer_graph = graph;
        window.CloudDeployDiagramState.set(current);
      }
      return;
    }
  });
})();
