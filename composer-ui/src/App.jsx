import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
} from "reactflow";
import "reactflow/dist/style.css";
import { layoutLR } from "./layout.js";
import { setupImportFromChat } from "./integration/importFromChat.js";
import { setupAIDiagramSync } from "./integration/aiDiagramSync.js";
import AwsServiceNode from "./nodes/AwsServiceNode.jsx";
import TextNoteNode from "./nodes/TextNoteNode.jsx";
import DiagramManagerPanel from "./components/DiagramManagerPanel.jsx";

const initialNodes = [
  { id: "vpc", position: { x: 0, y: 0 }, data: { label: "terraform-aws-vpc" } },
  { id: "eks", position: { x: 250, y: 0 }, data: { label: "terraform-aws-eks" } }
];

const initialEdges = [{ id: "e1", source: "vpc", target: "eks" }];

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [graphMeta, setGraphMeta] = useState({ stage: "diagram" });
  const [prompt, setPrompt] = useState("");
  const [editInstruction, setEditInstruction] = useState("");
  const aiSyncRef = useRef(null);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  // 1) Keep existing chat-import ability
  useEffect(() => {
    return setupImportFromChat({ setNodes, setEdges });
  }, [setNodes, setEdges]);

  // 2) Instantiate AI diagram sync (generate/edit + apply graph updates)
  useEffect(() => {
    aiSyncRef.current = setupAIDiagramSync({
      getNodes: () => nodes,
      getEdges: () => edges,
      setNodes,
      setEdges,
      getGraphMeta: () => graphMeta,
      setGraphMeta,
    });
    return () => aiSyncRef.current?.dispose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // instantiate once; it reads latest state via getters

  // 3) If user manually edits graph, notify parent so session stays in sync
  useEffect(() => {
    aiSyncRef.current?.notifyGraphChanged?.();
  }, [nodes, edges]);

  // Helper: Add AWS service node
  const addAwsNode = useCallback(
    (awsType) => {
      const typeLabels = {
        "aws.s3": "S3 Bucket",
        "aws.lambda": "Lambda Function",
        "aws.apigateway": "API Gateway",
        "aws.cloudfront": "CloudFront",
        "aws.rds": "RDS Database",
        "aws.vpc": "VPC",
      };

      const newNode = {
        id: `${awsType}-${Date.now()}`,
        type: "awsService",
        position: { x: Math.random() * 400, y: Math.random() * 400 },
        data: {
          label: typeLabels[awsType] || awsType,
          awsType: awsType,
        },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes]
  );

  // Helper: Add text note node
  const addTextNode = useCallback(() => {
    const newNode = {
      id: `text-${Date.now()}`,
      type: "textNote",
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      data: {
        text: "New Note",
        onChange: (id, text) => {
          setNodes((nds) =>
            nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n))
          );
        },
      },
    };

    setNodes((nds) => [...nds, newNode]);
  }, [setNodes]);

  // Handler: Generate diagram with AI
  const onGenerate = useCallback(() => {
    if (!prompt.trim()) return;
    aiSyncRef.current?.requestGenerate?.(prompt);
    setPrompt("");
  }, [prompt]);

  // Handler: Edit diagram with AI
  const onEdit = useCallback(() => {
    if (!editInstruction.trim()) return;
    aiSyncRef.current?.requestEdit?.(editInstruction);
    setEditInstruction("");
  }, [editInstruction]);

  // Handler: Analyze current manually-created diagram
  const onAnalyze = useCallback(() => {
    aiSyncRef.current?.requestAnalyze?.();
  }, []);

  // Register custom node types
  const nodeTypes = {
    awsService: AwsServiceNode,
    textNote: TextNoteNode,
  };

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <DiagramManagerPanel
        prompt={prompt}
        setPrompt={setPrompt}
        editInstruction={editInstruction}
        setEditInstruction={setEditInstruction}
        onGenerate={onGenerate}
        onEdit={onEdit}
        onAnalyze={onAnalyze}
        onAddAwsNode={addAwsNode}
        onAddTextNode={addTextNode}
        graphMeta={graphMeta}
      />

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
