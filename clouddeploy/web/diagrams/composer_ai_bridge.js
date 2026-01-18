// Parent-side bridge for Composer AI requests
// Calls /api/composer-ai and sends results back to Composer iframe

(() => {
  const COMPOSER_AI_ENDPOINT = "/api/composer-ai";

  /**
   * Call the Composer AI API
   */
  async function callComposerAI(payload) {
    try {
      const response = await fetch(COMPOSER_AI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Composer AI API call failed:", error);
      throw error;
    }
  }

  /**
   * Send result back to Composer iframe
   */
  function sendToComposer(messageType, data) {
    const frame = document.getElementById("composerFrame");
    if (!frame || !frame.contentWindow) {
      console.warn("Composer iframe not found");
      return;
    }

    frame.contentWindow.postMessage(
      {
        type: messageType,
        ...data,
      },
      "*"
    );
  }

  // Listen for Composer requests
  window.addEventListener("message", async (event) => {
    const msg = event?.data;
    if (!msg) return;

    try {
      // Handle diagram generation request
      if (msg.type === "clouddeploy:request_diagram_generate") {
        const prompt = (msg.prompt || "").toString().trim();
        if (!prompt) return;

        // Switch to composer tab to show progress
        const composerTab = document.querySelector('[data-tab="composer"]');
        composerTab?.click?.();

        // Call API
        const result = await callComposerAI({
          action: "diagram.generate",
          stage: "diagram",
          prompt: prompt,
        });

        // Send response back to Composer
        if (result.composer_graph) {
          sendToComposer("clouddeploy:apply_composer_graph", {
            graph: result.composer_graph,
          });
        }

        // Store in diagram state
        if (result.diagram && window.CloudDeployDiagramState) {
          window.CloudDeployDiagramState.set(result.diagram);
        }
        return;
      }

      // Handle diagram edit request
      if (msg.type === "clouddeploy:request_diagram_edit") {
        const instruction = (msg.instruction || "").toString().trim();
        const currentGraph = msg.current_graph;

        if (!instruction) return;

        // Switch to composer tab
        const composerTab = document.querySelector('[data-tab="composer"]');
        composerTab?.click?.();

        // Call API
        const result = await callComposerAI({
          action: "diagram.edit",
          stage: "diagram",
          instruction: instruction,
          current_graph: currentGraph,
        });

        // Send response back to Composer
        if (result.composer_graph) {
          sendToComposer("clouddeploy:apply_composer_graph", {
            graph: result.composer_graph,
          });
        }

        // Store in diagram state
        if (result.diagram && window.CloudDeployDiagramState) {
          window.CloudDeployDiagramState.set(result.diagram);
        }
        return;
      }

      // Handle "analyze current graph" request (blue Generate button)
      if (msg.type === "clouddeploy:request_diagram_from_graph") {
        const currentGraph = msg.current_graph;
        if (!currentGraph) return;

        // Call API for analysis
        const result = await callComposerAI({
          action: "diagram.from_graph",
          stage: "diagram",
          current_graph: currentGraph,
        });

        // Display analysis in chat
        if (result.diagram && result.diagram.content) {
          console.log("Diagram Analysis:", result.diagram.content);
          // TODO: Display analysis in chat UI
        }

        // Keep the graph as-is
        if (result.composer_graph) {
          sendToComposer("clouddeploy:apply_composer_graph", {
            graph: result.composer_graph,
          });
        }
        return;
      }

      // Handle plan generation request
      if (msg.type === "clouddeploy:request_plan_generate") {
        const currentGraph = msg.current_graph;
        const approvedDiagram = msg.approved_diagram || false;

        // Call API
        const result = await callComposerAI({
          action: "plan.generate",
          stage: "plan",
          current_graph: currentGraph,
          approved_diagram: approvedDiagram,
        });

        // Send plan back
        if (result.plan) {
          sendToComposer("clouddeploy:plan_ready", {
            plan: result.plan,
          });
        }
        return;
      }

      // Handle build generation request
      if (msg.type === "clouddeploy:request_build_generate") {
        const currentGraph = msg.current_graph;
        const approvedPlan = msg.approved_plan || false;
        const buildFormat = msg.build_format || "terraform";

        // Call API
        const result = await callComposerAI({
          action: "build.generate",
          stage: "build",
          current_graph: currentGraph,
          approved_plan: approvedPlan,
          build_format: buildFormat,
        });

        // Send build back
        if (result.build) {
          sendToComposer("clouddeploy:build_ready", {
            build: result.build,
          });
        }
        return;
      }

      // Handle graph change notifications (keep session in sync)
      if (msg.type === "clouddeploy:composer_graph_changed") {
        const graph = msg.graph;
        if (graph && window.CloudDeployDiagramState) {
          const current = window.CloudDeployDiagramState.get() || {};
          current.composer_graph = graph;
          window.CloudDeployDiagramState.set(current);
        }
        return;
      }
    } catch (error) {
      console.error("Error handling Composer message:", error);
      // Optionally send error back to Composer
      sendToComposer("clouddeploy:error", {
        error: error.message,
      });
    }
  });

  console.log("Composer AI Bridge initialized");
})();
