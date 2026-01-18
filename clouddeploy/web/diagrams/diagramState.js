// Simple in-memory state for the most recent diagram in the current chat session.

(() => {
  const state = {
    lastDiagram: null, // { diagram_format, title, code, summary_markdown, composer_graph }
  };

  window.CloudDeployDiagramState = {
    get() {
      return state.lastDiagram;
    },
    set(diagram) {
      state.lastDiagram = diagram || null;
    },
    clear() {
      state.lastDiagram = null;
    },
  };
})();
