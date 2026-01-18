// Receive architecture payloads from the Chat UI via window.postMessage.

export function setupImportFromChat({ setNodes, setEdges }) {
  function handler(event) {
    const msg = event?.data;
    if (!msg || msg.type !== "clouddeploy:import_graph") return;

    const graph = msg.composer_graph;
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return;

    const nodes = graph.nodes.map((n, idx) => ({
      id: String(n.id),
      position: { x: (idx % 5) * 220, y: Math.floor(idx / 5) * 120 },
      data: { label: n.label || n.type || n.id, awsType: n.type || "" },
      type: "awsService",
    }));

    const edges = graph.edges.map((e, idx) => ({
      id: `e${idx}`,
      source: String(e.source),
      target: String(e.target),
      label: e.label || undefined,
    }));

    setNodes(nodes);
    setEdges(edges);
  }

  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}
