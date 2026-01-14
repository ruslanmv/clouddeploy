import React, { useCallback, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState
} from "reactflow";
import "reactflow/dist/style.css";
import { layoutLR } from "./layout.js";

const initialNodes = [
  { id: "vpc", position: { x: 0, y: 0 }, data: { label: "terraform-aws-vpc" } },
  { id: "eks", position: { x: 250, y: 0 }, data: { label: "terraform-aws-eks" } }
];

const initialEdges = [{ id: "e1", source: "vpc", target: "eks" }];

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onAutoLayout = useCallback(() => {
    setNodes((ns) => layoutLR(ns, edges));
  }, [edges, setNodes]);

  const topBar = useMemo(() => (
    <div style={{ position: "absolute", top: 10, left: 10, zIndex: 10 }}>
      <button onClick={onAutoLayout} style={{ padding: "6px 10px" }}>
        Auto Layout (Dagre)
      </button>
    </div>
  ), [onAutoLayout]);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      {topBar}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
