import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Server,
  Database,
  Cloud,
  Shield,
  HardDrive,
  Network,
  Trash2,
  Download,
  Upload,
  Type,
  Maximize,
  Zap
} from 'lucide-react';
import { setupAIDiagramSync } from '../integration/aiDiagramSync.js';

const NODE_TYPES = [
  { id: 'aws.vpc', label: 'VPC', icon: Network, color: 'border-green-500 bg-green-50', textColor: 'text-green-700' },
  { id: 'aws.ec2', label: 'EC2 Instance', icon: Server, color: 'border-orange-500 bg-orange-50', textColor: 'text-orange-700' },
  { id: 'aws.s3', label: 'S3 Bucket', icon: HardDrive, color: 'border-blue-500 bg-blue-50', textColor: 'text-blue-700' },
  { id: 'aws.rds', label: 'RDS Database', icon: Database, color: 'border-blue-600 bg-blue-50', textColor: 'text-blue-800' },
  { id: 'aws.lambda', label: 'Lambda', icon: Cloud, color: 'border-orange-600 bg-orange-50', textColor: 'text-orange-800' },
  { id: 'aws.iam', label: 'IAM Role', icon: Shield, color: 'border-red-500 bg-red-50', textColor: 'text-red-700' },
  { id: 'text', label: 'Text Box', icon: Type, color: 'border-gray-300 bg-white', textColor: 'text-gray-700' },
];

export default function CloudDraft() {
  const [nodes, setNodes] = useState([
    { id: '1', x: 100, y: 100, label: 'Production VPC', type: 'aws.vpc', width: 240, height: 160 },
    { id: '2', x: 120, y: 140, label: 'Web Server', type: 'aws.ec2', width: 180, height: 80 },
  ]);

  const [draggedNode, setDraggedNode] = useState(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [graphMeta, setGraphMeta] = useState({ stage: 'diagram' });
  const [prompt, setPrompt] = useState('');
  const [editInstruction, setEditInstruction] = useState('');

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const aiSyncRef = useRef(null);

  // Convert CloudDraft nodes to composer_graph format
  const toComposerGraph = useCallback(() => {
    return {
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.type,
        label: n.label,
        props: {
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height
        }
      })),
      edges: [],
      metadata: { ...graphMeta, format: 'clouddraft' }
    };
  }, [nodes, graphMeta]);

  // Convert composer_graph format to CloudDraft nodes
  const fromComposerGraph = useCallback((graph) => {
    if (!graph || !graph.nodes) return;

    const newNodes = graph.nodes.map((n, idx) => {
      const typeInfo = NODE_TYPES.find(t => t.id === n.type) || NODE_TYPES[0];

      return {
        id: n.id,
        x: n.props?.x || (100 + (idx % 4) * 200),
        y: n.props?.y || (100 + Math.floor(idx / 4) * 150),
        label: n.label || typeInfo.label,
        type: n.type || 'aws.ec2',
        width: n.props?.width || (n.type === 'aws.vpc' ? 240 : 180),
        height: n.props?.height || (n.type === 'aws.vpc' ? 160 : 80),
      };
    });

    setNodes(newNodes);
    if (graph.metadata) {
      setGraphMeta(graph.metadata);
    }
  }, []);

  // Setup AI diagram sync
  useEffect(() => {
    aiSyncRef.current = setupAIDiagramSync({
      getNodes: () => {
        // Convert CloudDraft nodes to ReactFlow-like format for compatibility
        return nodes.map(n => ({
          id: n.id,
          type: n.type === 'text' ? 'textNote' : 'awsService',
          data: {
            label: n.label,
            awsType: n.type,
            text: n.type === 'text' ? n.label : undefined,
            props: { x: n.x, y: n.y, width: n.width, height: n.height }
          }
        }));
      },
      getEdges: () => [],
      setNodes: (rfNodes) => {
        // Convert ReactFlow nodes back to CloudDraft format
        const cloudDraftNodes = rfNodes.map(n => ({
          id: n.id,
          x: n.data?.props?.x || n.position?.x || 100,
          y: n.data?.props?.y || n.position?.y || 100,
          label: n.data?.label || n.data?.text || n.id,
          type: n.data?.awsType || n.type || 'aws.ec2',
          width: n.data?.props?.width || 180,
          height: n.data?.props?.height || 80,
        }));
        setNodes(cloudDraftNodes);
      },
      setEdges: () => {}, // CloudDraft doesn't use edges yet
      getGraphMeta: () => graphMeta,
      setGraphMeta: setGraphMeta,
    });

    return () => aiSyncRef.current?.dispose?.();
  }, []); // Empty deps - use getter functions

  // Notify parent when graph changes (manual edits)
  useEffect(() => {
    aiSyncRef.current?.notifyGraphChanged?.();
  }, [nodes]);

  // AI Handlers
  const handleAIGenerate = (e) => {
    e?.preventDefault();
    if (!prompt.trim()) return;
    aiSyncRef.current?.requestGenerate?.(prompt);
    setPrompt('');
  };

  const handleAIEdit = (e) => {
    e?.preventDefault();
    if (!editInstruction.trim()) return;
    aiSyncRef.current?.requestEdit?.(editInstruction);
    setEditInstruction('');
  };

  const handleAIAnalyze = () => {
    aiSyncRef.current?.requestAnalyze?.();
  };

  // --- External Drag and Drop (Sidebar to Canvas) ---

  const handleDragStartFromSidebar = (e, typeId) => {
    e.dataTransfer.setData('nodeType', typeId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDropOnCanvas = (e) => {
    e.preventDefault();
    const typeId = e.dataTransfer.getData('nodeType');
    if (!typeId) return;

    const typeInfo = NODE_TYPES.find(t => t.id === typeId);
    const rect = canvasRef.current.getBoundingClientRect();

    const rawX = e.clientX - rect.left - 50;
    const rawY = e.clientY - rect.top - 20;

    const x = Math.round(rawX / 20) * 20;
    const y = Math.round(rawY / 20) * 20;

    const newNode = {
      id: Math.random().toString(36).substr(2, 9),
      x,
      y,
      label: typeInfo.label,
      type: typeId,
      width: typeId === 'aws.vpc' ? 240 : 180,
      height: typeId === 'aws.vpc' ? 160 : 80,
    };

    setNodes(prev => [...prev, newNode]);
    setSelectedNodeId(newNode.id);
  };

  const handleDragOverCanvas = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  // --- Internal Canvas Dragging ---

  const handleMouseDown = (e, node) => {
    if (editingId) return;
    setDraggedNode(node.id);
    setSelectedNodeId(node.id);
    setOffset({
      x: e.clientX - node.x,
      y: e.clientY - node.y
    });
    e.stopPropagation();
  };

  const handleMouseMove = (e) => {
    if (draggedNode) {
      const newX = e.clientX - offset.x;
      const newY = e.clientY - offset.y;

      const snappedX = Math.round(newX / 20) * 20;
      const snappedY = Math.round(newY / 20) * 20;

      setNodes(nodes.map(node =>
        node.id === draggedNode ? { ...node, x: snappedX, y: snappedY } : node
      ));
    }
  };

  const handleMouseUp = () => {
    setDraggedNode(null);
  };

  const deleteSelected = () => {
    if (selectedNodeId) {
      setNodes(nodes.filter(n => n.id !== selectedNodeId));
      setSelectedNodeId(null);
    }
  };

  const handleLabelChange = (id, newLabel) => {
    setNodes(nodes.map(node =>
      node.id === id ? { ...node, label: newLabel } : node
    ));
  };

  // --- JSON Import/Export ---

  const exportToJson = () => {
    const dataStr = JSON.stringify(toComposerGraph(), null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', 'aws-infrastructure.json');
    linkElement.click();
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const importFromJson = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target.result);
        if (json.nodes && Array.isArray(json.nodes)) {
          fromComposerGraph(json);
        } else if (Array.isArray(json)) {
          // Legacy format
          setNodes(json);
        } else {
          console.error("Invalid JSON format");
        }
        setSelectedNodeId(null);
      } catch (err) {
        console.error("Error parsing JSON:", err);
      }
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden">
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".json"
        onChange={importFromJson}
      />

      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-slate-200 flex flex-col shadow-sm z-20">
        <div className="p-6 border-b border-slate-100">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Cloud className="text-blue-600" size={24} />
            CloudDraft
          </h1>
          <p className="text-xs text-slate-500 mt-1">AWS Infrastructure Builder</p>
        </div>

        {/* AI Controls */}
        <div className="p-4 border-b border-slate-100 space-y-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">AI Assistant</h3>

          <form onSubmit={handleAIGenerate}>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Generate diagram..."
              className="w-full text-xs p-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <button
              type="submit"
              className="w-full mt-1 flex items-center justify-center gap-1 p-2 rounded-md text-xs text-white bg-blue-600 hover:bg-blue-700 transition-colors"
            >
              <Zap size={12} /> Generate
            </button>
          </form>

          <form onSubmit={handleAIEdit}>
            <input
              value={editInstruction}
              onChange={(e) => setEditInstruction(e.target.value)}
              placeholder="Edit diagram..."
              className="w-full text-xs p-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <button
              type="submit"
              className="w-full mt-1 flex items-center justify-center gap-1 p-2 rounded-md text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              <Zap size={12} /> Apply Edit
            </button>
          </form>

          <button
            onClick={handleAIAnalyze}
            className="w-full flex items-center justify-center gap-1 p-2 rounded-md text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors"
          >
            <Zap size={12} /> Analyze Current
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <section>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Components</h3>
            <div className="grid grid-cols-1 gap-2">
              {NODE_TYPES.map((type) => (
                <div
                  key={type.id}
                  draggable="true"
                  onDragStart={(e) => handleDragStartFromSidebar(e, type.id)}
                  className="flex items-center gap-3 p-3 rounded-lg border border-slate-100 bg-white hover:border-blue-400 hover:bg-blue-50 transition-all text-sm font-medium text-slate-700 group cursor-grab active:cursor-grabbing"
                >
                  <type.icon size={18} className="text-slate-400 group-hover:text-blue-500" />
                  {type.label}
                </div>
              ))}
            </div>
          </section>

          <section className="pt-4 border-t border-slate-100">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Actions</h3>
            <div className="space-y-2">
              <button
                onClick={handleImportClick}
                className="w-full flex items-center gap-2 p-2 rounded-md text-sm text-slate-600 hover:bg-blue-50 hover:text-blue-600 transition-colors"
              >
                <Upload size={16} /> Import JSON
              </button>
              <button
                onClick={exportToJson}
                className="w-full flex items-center gap-2 p-2 rounded-md text-sm text-slate-600 hover:bg-green-50 hover:text-green-600 transition-colors"
              >
                <Download size={16} /> Export JSON
              </button>
              <div className="pt-2">
                <button
                  onClick={deleteSelected}
                  disabled={!selectedNodeId}
                  className={`w-full flex items-center gap-2 p-2 rounded-md text-sm transition-colors ${
                    selectedNodeId ? 'text-red-600 hover:bg-red-50' : 'text-slate-300 cursor-not-allowed'
                  }`}
                >
                  <Trash2 size={16} /> Delete Selected
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="p-4 border-t border-slate-100 text-[10px] text-slate-400 text-center">
          Drag items • AI Generate/Edit • JSON Import/Export
        </div>
      </div>

      {/* Canvas Area */}
      <div
        ref={canvasRef}
        className="flex-1 relative overflow-hidden bg-white select-none"
        onDragOver={handleDragOverCanvas}
        onDrop={handleDropOnCanvas}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={() => {
          setSelectedNodeId(null);
          setEditingId(null);
        }}
        style={{
          backgroundImage: 'radial-gradient(#e2e8f0 1px, transparent 1px)',
          backgroundSize: '20px 20px'
        }}
      >
        {nodes.map((node) => {
          const typeInfo = NODE_TYPES.find(t => t.id === node.type);
          const Icon = typeInfo.icon;
          const isSelected = selectedNodeId === node.id;
          const isEditing = editingId === node.id;

          return (
            <div
              key={node.id}
              onMouseDown={(e) => handleMouseDown(e, node)}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => {
                setEditingId(node.id);
                e.stopPropagation();
              }}
              style={{
                position: 'absolute',
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
                cursor: draggedNode === node.id ? 'grabbing' : 'grab',
                zIndex: isSelected ? 10 : 1,
              }}
              className={`
                group rounded-xl border-2 transition-shadow duration-200
                flex flex-col p-4
                ${typeInfo.color}
                ${isSelected ? 'ring-2 ring-blue-400 ring-offset-2 shadow-lg scale-[1.02]' : 'shadow-sm hover:shadow-md'}
              `}
            >
              <div className="flex items-start justify-between mb-2">
                <div className={`p-2 rounded-lg bg-white shadow-sm border border-slate-100 ${typeInfo.textColor}`}>
                  <Icon size={20} />
                </div>
                {isSelected && (
                  <button
                    onClick={() => setNodes(nodes.filter(n => n.id !== node.id))}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded text-red-500 transition-opacity"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {isEditing ? (
                <input
                  autoFocus
                  className="bg-white border border-blue-300 rounded px-2 py-1 text-sm font-semibold outline-none w-full"
                  value={node.label}
                  onChange={(e) => handleLabelChange(node.id, e.target.value)}
                  onBlur={() => setEditingId(null)}
                  onKeyDown={(e) => e.key === 'Enter' && setEditingId(null)}
                />
              ) : (
                <div className={`text-sm font-bold truncate ${typeInfo.textColor}`}>
                  {node.label}
                </div>
              )}

              <div className="mt-auto flex justify-between items-center text-[10px] text-slate-400 font-mono">
                <span>{node.type.toUpperCase()}</span>
                {isSelected && <Maximize size={10} className="text-slate-300" />}
              </div>
            </div>
          );
        })}

        {/* Floating Help */}
        <div className="absolute bottom-6 left-6 bg-white/80 backdrop-blur-md px-4 py-2 rounded-full border border-slate-200 shadow-sm flex items-center gap-4 text-xs text-slate-500 pointer-events-none">
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"></div> AI Generate/Edit</div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-orange-500"></div> Drag & Drop</div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500"></div> Double-click text</div>
        </div>

        {/* Stage indicator */}
        <div className="absolute top-6 right-6 bg-white/90 backdrop-blur-md px-3 py-2 rounded-lg border border-slate-200 shadow-sm text-xs text-slate-600">
          Stage: <span className="font-bold">{graphMeta?.stage || 'diagram'}</span>
        </div>
      </div>
    </div>
  );
}
