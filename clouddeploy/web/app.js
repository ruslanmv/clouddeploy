(() => {
  // -----------------------------
  // Helpers
  // -----------------------------
  const $ = (sel) => document.querySelector(sel);
  const nowTs = () => new Date().toISOString().replace("T", " ").replace("Z", "");

  function addTimeline(line, kind = "info") {
    const timeline = $("#timeline");
    const p = document.createElement("p");
    p.className =
      kind === "error"
        ? "text-red-600"
        : kind === "success"
        ? "text-green-700"
        : "text-gray-700";
    p.textContent = `[${nowTs()}] ${line}`;
    timeline.appendChild(p);
    timeline.scrollTop = timeline.scrollHeight;
  }

  function addAIMessage(text, who = "assistant") {
    const feed = $("#aiFeed");
    const wrap = document.createElement("div");
    wrap.className =
      who === "user"
        ? "rounded-lg border border-gray-200 p-3 bg-white text-sm text-gray-800"
        : "rounded-lg border border-gray-200 p-3 bg-gray-50 text-sm text-gray-800";
    wrap.textContent = text;
    feed.appendChild(wrap);
    feed.scrollTop = feed.scrollHeight;
  }

  function setStatusCard(text, icon = "info") {
    $("#statusCardText").textContent = text;
    const iconEl = $("#statusCard i");
    iconEl.className = "fas " + (icon === "ok" ? "fa-check" : icon === "warn" ? "fa-exclamation-triangle" : "fa-info");
  }

  // -----------------------------
  // Drawer toggle
  // -----------------------------
  const drawerToggle = $("#drawerToggle");
  const drawerContent = $("#drawerContent");
  const drawerIcon = $("#drawerIcon");

  drawerToggle.addEventListener("click", () => {
    drawerContent.classList.toggle("hidden");
    const open = !drawerContent.classList.contains("hidden");
    drawerIcon.classList.toggle("fa-chevron-up", !open);
    drawerIcon.classList.toggle("fa-chevron-down", open);
  });

  // -----------------------------
  // Tabs
  // -----------------------------
  const tabButtons = document.querySelectorAll(".tabBtn");
  const panels = {
    assistant: $("#tab-assistant"),
    summary: $("#tab-summary"),
    issues: $("#tab-issues"),
  };

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      tabButtons.forEach((b) => {
        b.classList.remove("text-primary-blue", "border-primary-blue", "border-b-2");
        b.classList.add("text-gray-500");
      });
      btn.classList.add("text-primary-blue", "border-primary-blue", "border-b-2");
      btn.classList.remove("text-gray-500");

      Object.keys(panels).forEach((k) => panels[k].classList.add("hidden"));
      panels[tab].classList.remove("hidden");
    });
  });

  // -----------------------------
  // xterm setup
  // -----------------------------
  const term = new Terminal({
    convertEol: true,
    fontSize: 13,
    cursorBlink: true,
    scrollback: 5000,
  });
  term.open($("#xterm"));
  term.focus();

  addTimeline("UI loaded. Connecting websockets…");

  // -----------------------------
  // WebSockets
  // -----------------------------
  const wsProto = location.protocol === "https:" ? "wss" : "ws";

  const wsOut = new WebSocket(`${wsProto}://${location.host}/ws/terminal`);
  const wsIn = new WebSocket(`${wsProto}://${location.host}/ws/terminal_input`);
  const wsState = new WebSocket(`${wsProto}://${location.host}/ws/state`);
  const wsAI = new WebSocket(`${wsProto}://${location.host}/ws/ai`);
  const wsAutopilot = new WebSocket(`${wsProto}://${location.host}/ws/autopilot`);

  wsOut.onopen = () => {
    addTimeline("Terminal output connected.", "success");
    setStatusCard("Connected. Waiting for terminal output…", "ok");
  };
  wsOut.onmessage = (ev) => term.write(ev.data);
  wsOut.onerror = () => addTimeline("Terminal output websocket error.", "error");
  wsOut.onclose = () => addTimeline("Terminal output disconnected.", "error");

  term.onData((data) => {
    if (wsIn.readyState === WebSocket.OPEN) wsIn.send(data);
  });

  wsIn.onopen = () => addTimeline("Terminal input connected.", "success");

  // -----------------------------
  // Prompt banner + quick actions
  // -----------------------------
  const banner = $("#promptBanner");
  const bannerText = $("#promptBannerText");
  const quickAction1 = $("#quickAction1");
  const quickAction2 = $("#quickAction2");
  const quickEnter = $("#quickEnter");

  function showBanner(prompt, choices) {
    banner.classList.remove("hidden");
    bannerText.textContent = `Waiting for input: ${prompt || "…"}`;

    // Render button labels (best effort)
    const c1 = choices && choices[0] ? choices[0] : "1";
    const c2 = choices && choices[1] ? choices[1] : "2";
    quickAction1.textContent = c1;
    quickAction2.textContent = c2;

    quickAction1.onclick = () => wsIn.readyState === WebSocket.OPEN && wsIn.send("1\n");
    quickAction2.onclick = () => wsIn.readyState === WebSocket.OPEN && wsIn.send("2\n");
    quickEnter.onclick = () => wsIn.readyState === WebSocket.OPEN && wsIn.send("\n");
  }

  function hideBanner() {
    banner.classList.add("hidden");
  }

  // -----------------------------
  // State channel (status, summary, issues)
  // -----------------------------
  let lastState = null;

  wsState.onopen = () => addTimeline("State channel connected.", "success");
  wsState.onmessage = (ev) => {
    const st = JSON.parse(ev.data);
    lastState = st;

    // Banner
    if (st.waiting_for_input) showBanner(st.prompt, st.choices);
    else hideBanner();

    // Status card
    if (st.completed) setStatusCard("Deployment completed.", "ok");
    else if (st.last_error) setStatusCard(`Error detected: ${st.last_error}`, "warn");
    else if (st.phase) setStatusCard(`Phase: ${st.phase}`, "info");

    // Summary tab: show raw JSON snapshot
    $("#summaryPre").textContent = JSON.stringify(st, null, 2);

    // Issues tab: show last_error if present
    const issues = $("#issuesList");
    issues.innerHTML = "";
    if (st.last_error) {
      const p = document.createElement("p");
      p.className = "text-red-600";
      p.textContent = `ERROR: ${st.last_error}`;
      issues.appendChild(p);
    } else {
      const p = document.createElement("p");
      p.className = "text-gray-500";
      p.textContent = "No issues detected yet.";
      issues.appendChild(p);
    }
  };
  wsState.onerror = () => addTimeline("State websocket error.", "error");

  // -----------------------------
  // AI chat
  // -----------------------------
  const aiInput = $("#aiInput");
  const aiSendBtn = $("#aiSendBtn");

  function sendAI() {
    const q = aiInput.value.trim();
    if (!q) return;
    aiInput.value = "";
    addAIMessage(q, "user");
    addTimeline(`AI question sent: ${q}`);
    if (wsAI.readyState === WebSocket.OPEN) wsAI.send(q);
  }

  aiSendBtn.addEventListener("click", sendAI);
  aiInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendAI();
  });

  wsAI.onopen = () => addTimeline("AI channel connected.", "success");
  wsAI.onmessage = (ev) => {
    addAIMessage(ev.data, "assistant");
    addTimeline("AI response received.", "success");
  };
  wsAI.onerror = () => addTimeline("AI websocket error.", "error");

  // -----------------------------
  // Autopilot control
  // -----------------------------
  const autopilotBtn = $("#autopilotBtn");
  const autopilotPill = $("#autopilotPill");
  let autopilotEnabled = false;

  function setAutopilotUI(on) {
    autopilotEnabled = on;
    autopilotBtn.innerHTML = `<i class="fas fa-robot mr-2"></i> Autopilot: ${on ? "On" : "Off"}`;

    if (on) {
      autopilotPill.className =
        "bg-status-running bg-opacity-10 text-status-running px-3 py-1 rounded-full text-sm font-medium flex items-center whitespace-nowrap";
      autopilotPill.innerHTML = `<span class="w-2 h-2 rounded-full bg-status-running mr-2"></span>Autopilot On`;
    } else {
      autopilotPill.className =
        "bg-gray-200 bg-opacity-50 text-gray-700 px-3 py-1 rounded-full text-sm font-medium flex items-center whitespace-nowrap";
      autopilotPill.innerHTML = `<span class="w-2 h-2 rounded-full bg-gray-400 mr-2"></span>Autopilot Off`;
    }
  }

  autopilotBtn.addEventListener("click", () => {
    if (wsAutopilot.readyState !== WebSocket.OPEN) return;
    wsAutopilot.send(JSON.stringify({ action: autopilotEnabled ? "stop" : "start" }));
  });

  wsAutopilot.onopen = () => addTimeline("Autopilot channel connected.", "success");
  wsAutopilot.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === "autopilot_status") {
      setAutopilotUI(!!msg.enabled);
      addTimeline(`Autopilot ${msg.enabled ? "enabled" : "disabled"}.`, msg.enabled ? "success" : "info");
      return;
    }

    if (msg.type === "autopilot_event") {
      const detail =
        msg.error ? ` | error: ${msg.error}` : msg.input ? ` | input: ${String(msg.input).trim()}` : "";
      addTimeline(`Autopilot event: ${msg.event}${detail}`, msg.event.includes("error") ? "error" : "info");
      addAIMessage(`🤖 ${msg.event}${detail}`, "assistant");
      return;
    }

    if (msg.type === "autopilot_state") {
      // optional: you can render state somewhere; we already show /ws/state
      return;
    }
  };

  // -----------------------------
  // Export logs (client-side capture)
  // -----------------------------
  // We export xterm buffer as text (best effort).
  $("#exportLogsBtn").addEventListener("click", () => {
    try {
      // xterm doesn't expose full buffer as plain string easily without addons; best effort:
      // we take the visible content by reading DOM (works well enough for v1).
      const text = $("#xterm").innerText || "";
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `clouddeploy-logs-${Date.now()}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      addTimeline("Logs exported.", "success");
    } catch (e) {
      addTimeline("Failed to export logs.", "error");
    }
  });

  // -----------------------------
  // End session (UI disconnect)
  // -----------------------------
  $("#endSessionBtn").addEventListener("click", () => {
    addTimeline("Disconnecting UI websockets…", "info");
    try { wsOut.close(); } catch (_) {}
    try { wsIn.close(); } catch (_) {}
    try { wsState.close(); } catch (_) {}
    try { wsAI.close(); } catch (_) {}
    try { wsAutopilot.close(); } catch (_) {}
    setStatusCard("Disconnected. Refresh to reconnect.", "warn");
  });
})();
