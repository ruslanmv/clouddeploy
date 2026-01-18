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
  Zap,
  Globe,
  Lock,
  Activity,
  Layers,
  Container,
  Radio,
  Bell,
  GitBranch,
  Cpu
} from 'lucide-react';
import { setupAIDiagramSync } from '../integration/aiDiagramSync.js';

const NODE_TYPES = [
  // Networking
  { id: 'aws.vpc', label: 'VPC', icon: Network, color: 'border-green-500 bg-green-50', textColor: 'text-green-700' },
  { id: 'aws.subnet', label: 'Subnet', icon: Network, color: 'border-green-400 bg-green-50', textColor: 'text-green-600' },
  { id: 'aws.internetgateway', label: 'Internet Gateway', icon: Globe, color: 'border-cyan-500 bg-cyan-50', textColor: 'text-cyan-700' },
  { id: 'aws.natgateway', label: 'NAT Gateway', icon: Globe, color: 'border-teal-500 bg-teal-50', textColor: 'text-teal-700' },
  { id: 'aws.alb', label: 'Application Load Balancer', icon: GitBranch, color: 'border-purple-500 bg-purple-50', textColor: 'text-purple-700' },
  { id: 'aws.nlb', label: 'Network Load Balancer', icon: GitBranch, color: 'border-purple-600 bg-purple-50', textColor: 'text-purple-800' },

  // Compute
  { id: 'aws.ec2', label: 'EC2 Instance', icon: Server, color: 'border-orange-500 bg-orange-50', textColor: 'text-orange-700' },
  { id: 'aws.lambda', label: 'Lambda Function', icon: Cloud, color: 'border-orange-600 bg-orange-50', textColor: 'text-orange-800' },
  { id: 'aws.ecs', label: 'ECS Cluster', icon: Container, color: 'border-orange-400 bg-orange-50', textColor: 'text-orange-600' },
  { id: 'aws.eks', label: 'EKS Cluster', icon: Layers, color: 'border-blue-700 bg-blue-50', textColor: 'text-blue-900' },
  { id: 'aws.fargate', label: 'Fargate', icon: Container, color: 'border-orange-300 bg-orange-50', textColor: 'text-orange-500' },

  // Storage
  { id: 'aws.s3', label: 'S3 Bucket', icon: HardDrive, color: 'border-blue-500 bg-blue-50', textColor: 'text-blue-700' },
  { id: 'aws.ebs', label: 'EBS Volume', icon: HardDrive, color: 'border-blue-400 bg-blue-50', textColor: 'text-blue-600' },
  { id: 'aws.efs', label: 'EFS File System', icon: HardDrive, color: 'border-blue-600 bg-blue-50', textColor: 'text-blue-800' },

  // Database
  { id: 'aws.rds', label: 'RDS Database', icon: Database, color: 'border-indigo-600 bg-indigo-50', textColor: 'text-indigo-800' },
  { id: 'aws.dynamodb', label: 'DynamoDB Table', icon: Database, color: 'border-indigo-500 bg-indigo-50', textColor: 'text-indigo-700' },
  { id: 'aws.elasticache', label: 'ElastiCache', icon: Database, color: 'border-indigo-400 bg-indigo-50', textColor: 'text-indigo-600' },
  { id: 'aws.aurora', label: 'Aurora Database', icon: Database, color: 'border-indigo-700 bg-indigo-50', textColor: 'text-indigo-900' },

  // Application Integration
  { id: 'aws.apigateway', label: 'API Gateway', icon: Radio, color: 'border-pink-500 bg-pink-50', textColor: 'text-pink-700' },
  { id: 'aws.sqs', label: 'SQS Queue', icon: Layers, color: 'border-pink-400 bg-pink-50', textColor: 'text-pink-600' },
  { id: 'aws.sns', label: 'SNS Topic', icon: Bell, color: 'border-pink-600 bg-pink-50', textColor: 'text-pink-800' },
  { id: 'aws.eventbridge', label: 'EventBridge', icon: Radio, color: 'border-pink-300 bg-pink-50', textColor: 'text-pink-500' },

  // Content Delivery & DNS
  { id: 'aws.cloudfront', label: 'CloudFront Distribution', icon: Globe, color: 'border-cyan-600 bg-cyan-50', textColor: 'text-cyan-800' },
  { id: 'aws.route53', label: 'Route 53', icon: Globe, color: 'border-cyan-700 bg-cyan-50', textColor: 'text-cyan-900' },

  // Security & IAM
  { id: 'aws.iam', label: 'IAM Role', icon: Shield, color: 'border-red-500 bg-red-50', textColor: 'text-red-700' },
  { id: 'aws.securitygroup', label: 'Security Group', icon: Lock, color: 'border-red-400 bg-red-50', textColor: 'text-red-600' },
  { id: 'aws.waf', label: 'WAF', icon: Shield, color: 'border-red-600 bg-red-50', textColor: 'text-red-800' },
  { id: 'aws.kms', label: 'KMS Key', icon: Lock, color: 'border-red-300 bg-red-50', textColor: 'text-red-500' },

  // Monitoring & Management
  { id: 'aws.cloudwatch', label: 'CloudWatch', icon: Activity, color: 'border-yellow-500 bg-yellow-50', textColor: 'text-yellow-700' },
  { id: 'aws.xray', label: 'X-Ray', icon: Activity, color: 'border-yellow-400 bg-yellow-50', textColor: 'text-yellow-600' },

  // Other
  { id: 'aws.stepfunctions', label: 'Step Functions', icon: GitBranch, color: 'border-violet-500 bg-violet-50', textColor: 'text-violet-700' },
  { id: 'aws.batch', label: 'Batch', icon: Cpu, color: 'border-gray-500 bg-gray-50', textColor: 'text-gray-700' },
  { id: 'text', label: 'Text Note', icon: Type, color: 'border-gray-300 bg-white', textColor: 'text-gray-700' },
];

export default function CloudDraft() {
  const [nodes, setNodes] = useState([
    { id: '1', x: 100, y: 100, label: 'Production VPC', type: 'aws.vpc', width: 280, height: 200 },
    { id: '2', x: 140, y: 160, label: 'Public Subnet', type: 'aws.subnet', width: 200, height: 100 },
    { id: '3', x: 160, y: 190, label: 'Web Server', type: 'aws.ec2', width: 160, height: 80 },
    { id: '4', x: 500, y: 100, label: 'S3 Storage', type: 'aws.s3', width: 160, height: 80 },
    { id: '5', x: 500, y: 220, label: 'RDS Database', type: 'aws.rds', width: 160, height: 80 },
  ]);

  // CloudDraft now supports edges (connections between node ports)
  const [edges, setEdges] = useState([
    // Example initial edge:
    // { id: 'e1', source: '3', target: '4', sourceSide: 'right', targetSide: 'left', label: null }
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

  // Linking interaction state
  // linking: { sourceId, sourceSide, startX, startY, currentX, currentY }
  const [linking, setLinking] = useState(null);
  // Hovered target port during linking: { nodeId, side }
  const [hoverPort, setHoverPort] = useState(null);

  const PORT_SIDES = ['left', 'right', 'top', 'bottom'];

  const getNodeById = useCallback((id) => nodes.find(n => String(n.id) === String(id)), [nodes]);

  const portXY = useCallback((node, side) => {
    if (!node) return { x: 0, y: 0 };
    const x = Number(node.x || 0);
    const y = Number(node.y || 0);
    const w = Number(node.width || 0);
    const h = Number(node.height || 0);
    switch (side) {
      case 'left': return { x, y: y + h / 2 };
      case 'right': return { x: x + w, y: y + h / 2 };
      case 'top': return { x: x + w / 2, y };
      case 'bottom': return { x: x + w / 2, y: y + h };
      default: return { x: x + w, y: y + h / 2 };
    }
  }, []);

  const edgePath = useCallback((p1, p2) => {
    // Smooth cubic curve
    const dx = Math.max(60, Math.abs(p2.x - p1.x) * 0.5);
    const c1 = { x: p1.x + dx, y: p1.y };
    const c2 = { x: p2.x - dx, y: p2.y };
    return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
  }, []);

  const edgeKey = (e) => `${String(e.source)}:${String(e.sourceSide)}->${String(e.target)}:${String(e.targetSide)}`;

  const addEdgeIfMissing = useCallback((next) => {
    setEdges((prev) => {
      const exists = prev.some((p) => edgeKey(p) === edgeKey(next));
      if (exists) return prev;
      return [...prev, next];
    });
  }, []);

  // Convert CloudDraft nodes to composer_graph format
  const toComposerGraph = useCallback(() => {
    return {
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.type, // Already has aws. prefix or 'text'
        label: n.label,
        props: {
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height
        }
      })),
      edges: edges.map(e => ({
        source: String(e.source),
        target: String(e.target),
        label: e.label ? String(e.label) : null,
      })),
      // Store port-side info in metadata so we can reconstruct visuals across modes
      metadata: {
        ...graphMeta,
        format: 'clouddraft',
        edgePorts: edges.map(e => ({
          source: String(e.source),
          target: String(e.target),
          sourceSide: e.sourceSide || 'right',
          targetSide: e.targetSide || 'left',
        }))
      }
    };
  }, [nodes, edges, graphMeta]);

  // Convert composer_graph format to CloudDraft nodes
  const fromComposerGraph = useCallback((graph) => {
    if (!graph || !graph.nodes) return;

    const newNodes = graph.nodes.map((n, idx) => {
      const typeInfo = NODE_TYPES.find(t => t.id === n.type) || NODE_TYPES[0];
      const isVpc = n.type === 'aws.vpc';
      const isSubnet = n.type === 'aws.subnet';

      return {
        id: n.id,
        x: n.props?.x || (100 + (idx % 4) * 220),
        y: n.props?.y || (100 + Math.floor(idx / 4) * 160),
        label: n.label || typeInfo.label,
        type: n.type, // Keep aws. prefix
        width: n.props?.width || (isVpc ? 280 : isSubnet ? 200 : 160),
        height: n.props?.height || (isVpc ? 200 : isSubnet ? 100 : 80),
      };
    });

    setNodes(newNodes);

    // Rebuild edges (connections). If metadata.edgePorts exists, keep side info.
    const metaPorts = Array.isArray(graph?.metadata?.edgePorts) ? graph.metadata.edgePorts : [];
    const rebuiltEdges = (graph.edges || []).map((e, idx) => {
      const found = metaPorts.find(p => String(p.source) === String(e.source) && String(p.target) === String(e.target));
      return {
        id: `e${idx}_${String(e.source)}_${String(e.target)}`,
        source: String(e.source),
        target: String(e.target),
        sourceSide: found?.sourceSide || 'right',
        targetSide: found?.targetSide || 'left',
        label: e.label || null,
      };
    });
    setEdges(rebuiltEdges);

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
            awsType: n.type, // Already has aws. prefix or 'text'
            text: n.type === 'text' ? n.label : undefined,
            props: { x: n.x, y: n.y, width: n.width, height: n.height }
          }
        }));
      },
      getEdges: () => {
        // Convert CloudDraft edges to ReactFlow-like edges (carry handle ids)
        return edges.map((e) => ({
          id: e.id || `e_${String(e.source)}_${String(e.target)}`,
          source: String(e.source),
          target: String(e.target),
          sourceHandle: e.sourceSide ? e.sourceSide[0] : undefined, // l/r/t/b
          targetHandle: e.targetSide ? e.targetSide[0] : undefined,
          label: e.label || undefined,
        }));
      },
      setNodes: (rfNodes) => {
        // Convert ReactFlow nodes back to CloudDraft format
        const cloudDraftNodes = rfNodes.map(n => {
          const awsType = n.data?.awsType || 'aws.ec2';
          const isVpc = awsType === 'aws.vpc';
          const isSubnet = awsType === 'aws.subnet';

          return {
            id: n.id,
            x: n.data?.props?.x || n.position?.x || 100,
            y: n.data?.props?.y || n.position?.y || 100,
            label: n.data?.label || n.data?.text || n.id,
            type: awsType, // Keep aws. prefix
            width: n.data?.props?.width || (isVpc ? 280 : isSubnet ? 200 : 160),
            height: n.data?.props?.height || (isVpc ? 200 : isSubnet ? 100 : 80),
          };
        });
        setNodes(cloudDraftNodes);
      },
      setEdges: (rfEdges) => {
        // Convert ReactFlow edges back to CloudDraft edges. Prefer metadata.edgePorts if present.
        const metaPorts = Array.isArray(graphMeta?.edgePorts) ? graphMeta.edgePorts : [];
        const cdEdges = (rfEdges || []).map((e, idx) => {
          const found = metaPorts.find(p => String(p.source) === String(e.source) && String(p.target) === String(e.target));
          const sh = e.sourceHandle || found?.sourceSide?.[0] || 'r';
          const th = e.targetHandle || found?.targetSide?.[0] || 'l';
          const mapSide = (h) => (h === 'l' ? 'left' : h === 'r' ? 'right' : h === 't' ? 'top' : 'bottom');
          return {
            id: e.id || `e${idx}_${String(e.source)}_${String(e.target)}`,
            source: String(e.source),
            target: String(e.target),
            sourceSide: found?.sourceSide || mapSide(sh),
            targetSide: found?.targetSide || mapSide(th),
            label: e.label || null,
          };
        });
        setEdges(cdEdges);
      },
      getGraphMeta: () => graphMeta,
      setGraphMeta: setGraphMeta,
    });

    return () => aiSyncRef.current?.dispose?.();
  }, []); // Empty deps - use getter functions

  // Notify parent when graph changes (manual edits)
  useEffect(() => {
    aiSyncRef.current?.notifyGraphChanged?.();
  }, [nodes, edges]);

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

    const isVpc = typeId === 'aws.vpc';
    const isSubnet = typeId === 'aws.subnet';

    const newNode = {
      id: Math.random().toString(36).substr(2, 9),
      x,
      y,
      label: typeInfo.label,
      type: typeId, // Already has aws. prefix
      width: isVpc ? 280 : isSubnet ? 200 : 160,
      height: isVpc ? 200 : isSubnet ? 100 : 80,
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

    if (linking) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      setLinking((prev) => prev ? ({
        ...prev,
        currentX: e.clientX - rect.left,
        currentY: e.clientY - rect.top,
      }) : prev);
    }
  };

  const handleMouseUp = () => {
    setDraggedNode(null);

    // Finish linking if we were connecting ports
    if (linking) {
      const target = hoverPort;
      if (target && String(target.nodeId) !== String(linking.sourceId)) {
        addEdgeIfMissing({
          id: `e_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          source: String(linking.sourceId),
          target: String(target.nodeId),
          sourceSide: linking.sourceSide || 'right',
          targetSide: target.side || 'left',
          label: null,
        });
      }
      setLinking(null);
      setHoverPort(null);
    }
  };

  const deleteSelected = () => {
    if (selectedNodeId) {
      setNodes(nodes.filter(n => n.id !== selectedNodeId));
      setEdges(edges.filter(e => String(e.source) !== String(selectedNodeId) && String(e.target) !== String(selectedNodeId)));
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
          setEdges([]);
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

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <section>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">AWS Services</h3>
            <p className="text-[10px] text-slate-400 mb-3">Drag services onto the canvas</p>
            <div className="space-y-4">
              {/* Networking */}
              <div>
                <div className="text-[10px] font-semibold text-slate-500 mb-1">NETWORKING</div>
                <div className="grid grid-cols-1 gap-1">
                  {NODE_TYPES.filter(t => ['aws.vpc', 'aws.subnet', 'aws.internetgateway', 'aws.natgateway', 'aws.alb', 'aws.nlb'].includes(t.id)).map((type) => (
                    <div
                      key={type.id}
                      draggable="true"
                      onDragStart={(e) => handleDragStartFromSidebar(e, type.id)}
                      className="flex items-center gap-2 p-2 rounded-md border border-slate-100 bg-white hover:border-blue-400 hover:bg-blue-50 transition-all text-xs font-medium text-slate-700 group cursor-grab active:cursor-grabbing"
                    >
                      <type.icon size={14} className="text-slate-400 group-hover:text-blue-500 flex-shrink-0" />
                      <span className="truncate">{type.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Compute */}
              <div>
                <div className="text-[10px] font-semibold text-slate-500 mb-1">COMPUTE</div>
                <div className="grid grid-cols-1 gap-1">
                  {NODE_TYPES.filter(t => ['aws.ec2', 'aws.lambda', 'aws.ecs', 'aws.eks', 'aws.fargate'].includes(t.id)).map((type) => (
                    <div
                      key={type.id}
                      draggable="true"
                      onDragStart={(e) => handleDragStartFromSidebar(e, type.id)}
                      className="flex items-center gap-2 p-2 rounded-md border border-slate-100 bg-white hover:border-blue-400 hover:bg-blue-50 transition-all text-xs font-medium text-slate-700 group cursor-grab active:cursor-grabbing"
                    >
                      <type.icon size={14} className="text-slate-400 group-hover:text-blue-500 flex-shrink-0" />
                      <span className="truncate">{type.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Storage */}
              <div>
                <div className="text-[10px] font-semibold text-slate-500 mb-1">STORAGE</div>
                <div className="grid grid-cols-1 gap-1">
                  {NODE_TYPES.filter(t => ['aws.s3', 'aws.ebs', 'aws.efs'].includes(t.id)).map((type) => (
                    <div
                      key={type.id}
                      draggable="true"
                      onDragStart={(e) => handleDragStartFromSidebar(e, type.id)}
                      className="flex items-center gap-2 p-2 rounded-md border border-slate-100 bg-white hover:border-blue-400 hover:bg-blue-50 transition-all text-xs font-medium text-slate-700 group cursor-grab active:cursor-grabbing"
                    >
                      <type.icon size={14} className="text-slate-400 group-hover:text-blue-500 flex-shrink-0" />
                      <span className="truncate">{type.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Database */}
              <div>
                <div className="text-[10px] font-semibold text-slate-500 mb-1">DATABASE</div>
                <div className="grid grid-cols-1 gap-1">
                  {NODE_TYPES.filter(t => ['aws.rds', 'aws.dynamodb', 'aws.elasticache', 'aws.aurora'].includes(t.id)).map((type) => (
                    <div
                      key={type.id}
                      draggable="true"
                      onDragStart={(e) => handleDragStartFromSidebar(e, type.id)}
                      className="flex items-center gap-2 p-2 rounded-md border border-slate-100 bg-white hover:border-blue-400 hover:bg-blue-50 transition-all text-xs font-medium text-slate-700 group cursor-grab active:cursor-grabbing"
                    >
                      <type.icon size={14} className="text-slate-400 group-hover:text-blue-500 flex-shrink-0" />
                      <span className="truncate">{type.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Application Integration */}
              <div>
                <div className="text-[10px] font-semibold text-slate-500 mb-1">INTEGRATION</div>
                <div className="grid grid-cols-1 gap-1">
                  {NODE_TYPES.filter(t => ['aws.apigateway', 'aws.sqs', 'aws.sns', 'aws.eventbridge'].includes(t.id)).map((type) => (
                    <div
                      key={type.id}
                      draggable="true"
                      onDragStart={(e) => handleDragStartFromSidebar(e, type.id)}
                      className="flex items-center gap-2 p-2 rounded-md border border-slate-100 bg-white hover:border-blue-400 hover:bg-blue-50 transition-all text-xs font-medium text-slate-700 group cursor-grab active:cursor-grabbing"
                    >
                      <type.icon size={14} className="text-slate-400 group-hover:text-blue-500 flex-shrink-0" />
                      <span className="truncate">{type.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Security & CDN */}
              <div>
                <div className="text-[10px] font-semibold text-slate-500 mb-1">SECURITY & CDN</div>
                <div className="grid grid-cols-1 gap-1">
                  {NODE_TYPES.filter(t => ['aws.cloudfront', 'aws.route53', 'aws.iam', 'aws.securitygroup', 'aws.waf', 'aws.kms'].includes(t.id)).map((type) => (
                    <div
                      key={type.id}
                      draggable="true"
                      onDragStart={(e) => handleDragStartFromSidebar(e, type.id)}
                      className="flex items-center gap-2 p-2 rounded-md border border-slate-100 bg-white hover:border-blue-400 hover:bg-blue-50 transition-all text-xs font-medium text-slate-700 group cursor-grab active:cursor-grabbing"
                    >
                      <type.icon size={14} className="text-slate-400 group-hover:text-blue-500 flex-shrink-0" />
                      <span className="truncate">{type.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Monitoring & Other */}
              <div>
                <div className="text-[10px] font-semibold text-slate-500 mb-1">MONITORING & OTHER</div>
                <div className="grid grid-cols-1 gap-1">
                  {NODE_TYPES.filter(t => ['aws.cloudwatch', 'aws.xray', 'aws.stepfunctions', 'aws.batch', 'text'].includes(t.id)).map((type) => (
                    <div
                      key={type.id}
                      draggable="true"
                      onDragStart={(e) => handleDragStartFromSidebar(e, type.id)}
                      className="flex items-center gap-2 p-2 rounded-md border border-slate-100 bg-white hover:border-blue-400 hover:bg-blue-50 transition-all text-xs font-medium text-slate-700 group cursor-grab active:cursor-grabbing"
                    >
                      <type.icon size={14} className="text-slate-400 group-hover:text-blue-500 flex-shrink-0" />
                      <span className="truncate">{type.label}</span>
                    </div>
                  ))}
                </div>
              </div>
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
        {/* Edges layer (SVG under nodes, above background). */}
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        >
          {edges.map((e) => {
            const sNode = getNodeById(e.source);
            const tNode = getNodeById(e.target);
            if (!sNode || !tNode) return null;
            const p1 = portXY(sNode, e.sourceSide || 'right');
            const p2 = portXY(tNode, e.targetSide || 'left');
            return (
              <path
                key={e.id || edgeKey(e)}
                d={edgePath(p1, p2)}
                fill="none"
                stroke="rgba(59,130,246,0.85)"
                strokeWidth="2"
              />
            );
          })}
          {/* Live preview while linking */}
          {linking ? (() => {
            const sNode = getNodeById(linking.sourceId);
            if (!sNode) return null;
            const p1 = portXY(sNode, linking.sourceSide || 'right');
            const p2 = { x: linking.currentX || p1.x, y: linking.currentY || p1.y };
            return (
              <path
                d={edgePath(p1, p2)}
                fill="none"
                stroke="rgba(59,130,246,0.45)"
                strokeWidth="2"
                strokeDasharray="6 6"
              />
            );
          })() : null}
        </svg>

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
                zIndex: isSelected ? 10 : 2,
              }}
              className={`
                group rounded-xl border-2 transition-shadow duration-200
                flex flex-col p-4
                ${typeInfo.color}
                ${isSelected ? 'ring-2 ring-blue-400 ring-offset-2 shadow-lg scale-[1.02]' : 'shadow-sm hover:shadow-md'}
              `}
            >
              {/* Ports (handles) */}
              {PORT_SIDES.map((side) => (
                <div
                  key={side}
                  onMouseDown={(e) => {
                    // Start linking from this port.
                    e.stopPropagation();
                    e.preventDefault();
                    const rect = canvasRef.current?.getBoundingClientRect();
                    const p = portXY(node, side);
                    setLinking({
                      sourceId: node.id,
                      sourceSide: side,
                      startX: p.x,
                      startY: p.y,
                      currentX: rect ? (e.clientX - rect.left) : p.x,
                      currentY: rect ? (e.clientY - rect.top) : p.y,
                    });
                  }}
                  onMouseEnter={() => setHoverPort({ nodeId: node.id, side })}
                  onMouseLeave={() => setHoverPort((prev) => (prev && prev.nodeId === node.id && prev.side === side ? null : prev))}
                  style={{
                    position: 'absolute',
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    background: 'white',
                    border: '2px solid rgba(59,130,246,0.9)',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
                    cursor: 'crosshair',
                    top: side === 'top' ? -6 : side === 'bottom' ? undefined : '50%',
                    bottom: side === 'bottom' ? -6 : undefined,
                    left: side === 'left' ? -6 : side === 'right' ? undefined : '50%',
                    right: side === 'right' ? -6 : undefined,
                    transform:
                      side === 'left' || side === 'right'
                        ? 'translateY(-50%)'
                        : 'translateX(-50%)',
                    opacity: isSelected ? 1 : 0.25,
                    transition: 'opacity 120ms ease',
                    zIndex: 20,
                  }}
                />
              ))}

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
