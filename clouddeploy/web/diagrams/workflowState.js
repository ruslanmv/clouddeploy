(() => {
  const state = {
    stage: "diagram",        // diagram -> plan -> build
    diagramApproved: false,
    planApproved: false,
    lastDiagram: null,       // { code, composer_graph, ... }
  };

  window.CloudDeployWorkflow = {
    get() {
      return { ...state };
    },
    setStage(stage) {
      state.stage = stage;
    },
    approveDiagram(diagramObj) {
      state.diagramApproved = true;
      state.lastDiagram = diagramObj || state.lastDiagram;
      state.stage = "plan";
    },
    approvePlan() {
      state.planApproved = true;
      state.stage = "build";
    },
    reset() {
      state.stage = "diagram";
      state.diagramApproved = false;
      state.planApproved = false;
      state.lastDiagram = null;
    },
  };
})();
