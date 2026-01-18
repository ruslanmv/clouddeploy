// Composer -> parent window: request a diagram generation
export function requestDiagramFromParent(prompt) {
  if (!prompt || !prompt.trim()) return;

  window.parent?.postMessage(
    {
      type: "clouddeploy:request_diagram",
      prompt: prompt.trim(),
      // optional hints for the parent
      mode: "diagram",
      cloud: "aws",
    },
    "*"
  );
}
