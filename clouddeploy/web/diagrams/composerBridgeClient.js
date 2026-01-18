// Best-effort bridge from Chat -> Composer.
// V1: postMessage to iframe#composerFrame (if present).

(() => {
  function openInComposer(payload) {
    const frame = document.getElementById("composerFrame");
    if (!frame || !frame.contentWindow) {
      alert("Composer is not available in this UI layout.");
      return;
    }
    frame.contentWindow.postMessage(
      {
        type: "clouddeploy:import_graph",
        diagram_format: payload?.diagram?.diagram_format || "mermaid",
        code: payload?.code || "",
        composer_graph: payload?.diagram?.composer_graph || null,
      },
      "*"
    );
  }

  window.CloudDeployComposerBridge = { openInComposer };
})();
