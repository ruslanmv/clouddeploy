// composer-ui/src/integration/aiDiagramSync.js
// Responsibilities:
// 1) Let Composer request diagram generation/edit from parent (chat app)
// 2) Receive updated composer_graph from parent and load it into ReactFlow
// 3) Emit "graph changed" events to parent (optional) so chat session stays in sync

export function setupAIDiagramSync({
  getNodes,
  getEdges,
  setNodes,
  setEdges,
  getGraphMeta,
  setGraphMeta,
}) {
  function toComposerGraph(nodes, edges, meta) {
    return {
      nodes: (nodes || []).map((n) => {
        // Handle text notes differently
        if (n.type === "textNote") {
          return {
            id: String(n.id),
            type: "text",
            label: String(n?.data?.text || "Note"),
            props: { text: String(n?.data?.text || "") },
          };
        }
        // Handle AWS service nodes
        return {
          id: String(n.id),
          type: String(n?.data?.awsType || n?.data?.type || n?.data?.resourceType || ""),
          label: String(n?.data?.label || n?.data?.name || n.id),
          props: { ...(n?.data?.props || {}) },
        };
      }),
      edges: (edges || []).map((e) => ({
        source: String(e.source),
        target: String(e.target),
        label: e.label ? String(e.label) : null,
      })),
      metadata: { ...(meta || {}) },
    };
  }

  function fromComposerGraph(graph) {
    const nodes = (graph?.nodes || []).map((n, idx) => {
      // Handle text notes
      if (n.type === "text") {
        return {
          id: String(n.id),
          position: { x: (idx % 5) * 240, y: Math.floor(idx / 5) * 140 },
          type: "textNote",
          data: {
            text: n.props?.text || n.label || "Note",
          },
        };
      }
      // Handle AWS service nodes
      return {
        id: String(n.id),
        position: { x: (idx % 5) * 240, y: Math.floor(idx / 5) * 140 },
        type: "awsService",
        data: {
          label: n.label || n.type || n.id,
          awsType: n.type || "",
          props: { ...(n.props || {}) },
        },
      };
    });

    const edges = (graph?.edges || []).map((e, idx) => ({
      id: `e${idx}_${String(e.source)}_${String(e.target)}`,
      source: String(e.source),
      target: String(e.target),
      label: e.label || undefined,
    }));

    return { nodes, edges, metadata: graph?.metadata || {} };
  }

  // --- Composer -> Parent requests ---
  function requestGenerate(prompt) {
    window.parent?.postMessage(
      { type: "clouddeploy:request_diagram_generate", prompt: String(prompt || "").trim() },
      "*"
    );
  }

  function requestEdit(instruction) {
    // Send current graph so AI edits the existing diagram
    const graph = toComposerGraph(getNodes(), getEdges(), getGraphMeta?.());
    window.parent?.postMessage(
      {
        type: "clouddeploy:request_diagram_edit",
        instruction: String(instruction || "").trim(),
        current_graph: graph,
      },
      "*"
    );
  }

  function requestAnalyze() {
    // Send current graph for AI analysis (blue "Generate" button)
    const graph = toComposerGraph(getNodes(), getEdges(), getGraphMeta?.());
    window.parent?.postMessage(
      {
        type: "clouddeploy:request_diagram_from_graph",
        current_graph: graph,
      },
      "*"
    );
  }

  function notifyGraphChanged() {
    // optional: keep parent session in sync when user manually edits
    const graph = toComposerGraph(getNodes(), getEdges(), getGraphMeta?.());
    window.parent?.postMessage({ type: "clouddeploy:composer_graph_changed", graph }, "*");
  }

  // --- Parent -> Composer updates ---
  function onMessage(event) {
    const msg = event?.data;
    if (!msg) return;

    // Parent sends updated graph (AI generated/edited)
    if (msg.type === "clouddeploy:apply_composer_graph") {
      const { nodes, edges, metadata } = fromComposerGraph(msg.graph);
      setNodes(nodes);
      setEdges(edges);
      setGraphMeta?.(metadata);
      return;
    }

    // Parent signals stage changes (diagram approved -> plan, etc.)
    if (msg.type === "clouddeploy:set_stage") {
      setGraphMeta?.({ ...(getGraphMeta?.() || {}), stage: msg.stage || "diagram" });
      return;
    }
  }

  window.addEventListener("message", onMessage);

  return {
    requestGenerate,
    requestEdit,
    requestAnalyze,
    notifyGraphChanged,
    dispose() {
      window.removeEventListener("message", onMessage);
    },
  };
}
