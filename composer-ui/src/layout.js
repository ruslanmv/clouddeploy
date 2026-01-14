import dagre from "dagre";

export function layoutLR(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR" });

  nodes.forEach((n) => g.setNode(n.id, { width: 180, height: 60 }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const p = g.node(n.id);
    return { ...n, position: { x: p.x, y: p.y } };
  });
}
