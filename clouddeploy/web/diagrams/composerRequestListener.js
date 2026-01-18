// Parent page listener: receives diagram requests from composer iframe
// Requires window.CloudDeploySendAI(text) to exist (we add it in a tiny patch to app.js).

(() => {
  function normalizePromptToDiagram(prompt) {
    // IMPORTANT: Your server protocol only outputs type:"diagram" when explicitly asked.
    // So we hard-force the request to be explicitly diagram generation.
    return (
      "MODE: DIAGRAM\n" +
      "OUTPUT: diagram\n" +
      "CLOUD: aws\n\n" +
      "Generate an AWS architecture diagram for this request. " +
      "Return JSON with type=\"diagram\" and a Mermaid architecture-beta diagram.\n\n" +
      "REQUEST:\n" +
      prompt
    );
  }

  window.addEventListener("message", (event) => {
    const msg = event?.data;
    if (!msg || msg.type !== "clouddeploy:request_diagram") return;

    const prompt = (msg.prompt || "").toString().trim();
    if (!prompt) return;

    if (typeof window.CloudDeploySendAI !== "function") {
      console.warn("CloudDeploySendAI is not available; cannot send to AI websocket.");
      return;
    }

    // Switch to assistant tab to show output (optional)
    const btn = document.querySelector('[data-tab="assistant"]');
    btn?.click?.();

    window.CloudDeploySendAI(normalizePromptToDiagram(prompt));
  });
})();
