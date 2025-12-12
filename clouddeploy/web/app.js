// clouddeploy/web/app.js
// Production-ready CloudDeploy frontend (no bundler)
// Requires xterm loaded globally via <script src=".../xterm.js"></script>

(() => {
  const $ = (sel) => document.querySelector(sel);
  const wsProto = location.protocol === "https:" ? "wss" : "ws";
  const wsBase = `${wsProto}://${location.host}`;
  const nowTs = () => new Date().toISOString().replace("T", " ").replace("Z", "");

  function timeline(msg, kind = "info") {
    const el = $("#timeline");
    if (!el) return;
    const p = document.createElement("p");
    p.className =
      kind === "error"
        ? "text-red-600"
        : kind === "success"
        ? "text-green-700"
        : "text-gray-700";
    p.textContent = `[${nowTs()}] ${msg}`;
    el.appendChild(p);
    el.scrollTop = el.scrollHeight;
  }

  function aiMessage(text, who = "assistant") {
    const feed = $("#aiFeed");
    if (!feed) return;
    const box = document.createElement("div");
    box.className =
      who === "user"
        ? "rounded-lg border border-gray-200 p-3 bg-white text-sm text-gray-800"
        : "rounded-lg border border-gray-200 p-3 bg-gray-50 text-sm text-gray-800";
    box.textContent = text;
    feed.appendChild(box);
    feed.scrollTop = feed.scrollHeight;
  }

  function clearAiChat({ greet = true } = {}) {
    const feed = $("#aiFeed");
    if (feed) feed.innerHTML = "";
    if (greet) {
      aiMessage(
        "Hi! I’m your CloudDeploy copilot. Start a session and I’ll guide you step-by-step.",
        "assistant"
      );
    }
  }

  function setStatus(text) {
    const el = $("#statusCardText");
    if (el) el.textContent = text;
  }

  function setRuntimePill(text, ok = true) {
    const pill = $("#runtimePill");
    if (!pill) return;
    pill.innerHTML = `<span class="w-2 h-2 rounded-full ${
      ok ? "bg-status-running" : "bg-red-500"
    } mr-2"></span>${text}`;
    pill.className = ok
      ? "bg-status-running bg-opacity-10 text-status-running px-3 py-1 rounded-full text-sm font-medium flex items-center whitespace-nowrap"
      : "bg-red-100 text-red-700 px-3 py-1 rounded-full text-sm font-medium flex items-center whitespace-nowrap";
  }

  function disable(el, on) {
    if (!el) return;
    el.disabled = !!on;
    el.classList.toggle("opacity-50", !!on);
    el.classList.toggle("cursor-not-allowed", !!on);
  }

  function safeJSONParse(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  // ----------------------------------------------------------------------------
  // Robust WS creator: if any websocket disconnects unexpectedly, force reload.
  // Enterprise UX: avoid half-broken UI states.
  // ----------------------------------------------------------------------------
  function makeWS(url, name) {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => timeline(`${name} connected.`, "success"));
    ws.addEventListener("error", () => timeline(`${name} error.`, "error"));
    ws.addEventListener("close", () => {
      if (!window.__clouddeploy_intentional_close__) {
        timeline(`${name} disconnected. Reloading…`, "error");
        setTimeout(() => location.reload(), 250);
      }
    });
    return ws;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    // -----------------------------
    // Drawer toggle
    // -----------------------------
    const drawerToggle = $("#drawerToggle");
    const drawerContent = $("#drawerContent");
    const drawerIcon = $("#drawerIcon");
    if (drawerToggle && drawerContent && drawerIcon) {
      drawerToggle.addEventListener("click", () => {
        drawerContent.classList.toggle("hidden");
        const open = !drawerContent.classList.contains("hidden");
        drawerIcon.classList.toggle("fa-chevron-up", !open);
        drawerIcon.classList.toggle("fa-chevron-down", open);
      });
    }

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
        Object.keys(panels).forEach((k) => panels[k]?.classList.add("hidden"));
        panels[tab]?.classList.remove("hidden");
      });
    });

    // -----------------------------
    // Terminal
    // -----------------------------
    const termEl = $("#xterm");
    if (!termEl || !window.Terminal) {
      console.error("Missing #xterm or xterm.js");
      return;
    }

    const term = new window.Terminal({
      cursorBlink: true,
      convertEol: true,
      fontSize: 13,
      scrollback: 5000,
      theme: { background: "#1e1e1e" },
    });
    term.open(termEl);

    term.focus();
    termEl.addEventListener("mousedown", () => term.focus());
    termEl.addEventListener("touchstart", () => term.focus(), { passive: true });

    timeline("UI loaded.");

    // -----------------------------
    // UI Mode (WELCOME / RUNNING)
    // -----------------------------
    const UI_MODE = {
      WELCOME: "WELCOME",
      RUNNING: "RUNNING",
    };
    let uiMode = UI_MODE.WELCOME;

    function setUiMode(next, { commandLabel = "" } = {}) {
      uiMode = next;
      setRuntimePill("Connected", true);

      if (next === UI_MODE.WELCOME) {
        setStatus("Pick a script to start.");
      } else {
        setStatus(commandLabel ? `Running: ${commandLabel}` : "Running session…");
      }
    }

    // -----------------------------
    // WebSockets
    // -----------------------------
    window.__clouddeploy_intentional_close__ = false;

    const wsTerminalOut = makeWS(`${wsBase}/ws/terminal`, "Terminal output");
    const wsTerminalIn = makeWS(`${wsBase}/ws/terminal_input`, "Terminal input");
    const wsState = makeWS(`${wsBase}/ws/state`, "State");
    const wsAI = makeWS(`${wsBase}/ws/ai`, "AI");
    const wsAutopilot = makeWS(`${wsBase}/ws/autopilot`, "Autopilot");

    let wsInReady = false;
    let sessionStarted = false;

    wsTerminalOut.addEventListener("open", () => setRuntimePill("Connected", true));
    wsTerminalOut.addEventListener("message", (ev) => term.write(ev.data));

    wsTerminalIn.addEventListener("open", () => (wsInReady = true));
    wsTerminalIn.addEventListener("close", () => (wsInReady = false));

    function canTypeTerminal() {
      return (
        uiMode === UI_MODE.RUNNING &&
        sessionStarted &&
        wsInReady &&
        wsTerminalIn.readyState === WebSocket.OPEN
      );
    }

    function sendToTerminal(data, { submit = false } = {}) {
      if (!canTypeTerminal()) return false;
      const payload = submit ? `${data}\r` : data;
      term.focus();
      wsTerminalIn.send(payload);
      return true;
    }

    term.onData((data) => {
      if (!canTypeTerminal()) return;
      wsTerminalIn.send(data);
    });

    // -----------------------------
    // Prompt banner
    // -----------------------------
    const banner = $("#promptBanner");
    const bannerText = $("#promptBannerText");
    const quick1 = $("#quickAction1");
    const quick2 = $("#quickAction2");
    const quickEnter = $("#quickEnter");

    function showBanner(prompt, choices) {
      if (!banner) return;
      banner.classList.remove("hidden");
      if (bannerText) bannerText.textContent = `Waiting for input: ${prompt || "…"}`;

      const c1 = choices?.[0] || "1";
      const c2 = choices?.[1] || "2";
      if (quick1) quick1.textContent = c1;
      if (quick2) quick2.textContent = c2;

      if (quick1) quick1.onclick = () => sendToTerminal("1", { submit: true });
      if (quick2) quick2.onclick = () => sendToTerminal("2", { submit: true });
      if (quickEnter) quickEnter.onclick = () => sendToTerminal("", { submit: true });

      disable(quick1, !canTypeTerminal());
      disable(quick2, !canTypeTerminal());
      disable(quickEnter, !canTypeTerminal());
    }

    function hideBanner() {
      banner?.classList.add("hidden");
    }

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const active = document.activeElement;
      if (active && active.id === "aiInput") return;
      if (!banner || banner.classList.contains("hidden")) return;
      e.preventDefault();
      sendToTerminal("", { submit: true });
    });

    // -----------------------------
    // Script picker modal
    // -----------------------------
    const scriptModal = $("#scriptModal");
    const scriptList = $("#scriptList");
    const scriptCancelBtn = $("#scriptCancelBtn");
    const scriptCancelBtnX = $("#scriptCancelBtnX");
    const scriptStartBtn = $("#scriptStartBtn");
    const scriptSelectedLabel = $("#scriptSelectedLabel");

    let selectedScript = null;
    let cachedScripts = [];
    let switchMode = false; // user clicked End Session (but we haven't stopped anything yet)

    function openScriptModal() {
      scriptModal?.classList.remove("hidden");
      scriptModal?.classList.add("pointer-events-auto");
    }
    function closeScriptModal() {
      scriptModal?.classList.add("hidden");
    }

    function setSelectedScript(s) {
      selectedScript = s;
      if (scriptSelectedLabel) {
        scriptSelectedLabel.textContent = s ? `Selected: ${s.name}` : "No script selected";
      }
      disable(scriptStartBtn, !s);
    }

    function renderScripts(scripts) {
      if (!scriptList) return;

      scriptList.innerHTML = "";
      scripts.forEach((s) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className =
          "w-full text-left rounded-lg border border-gray-200 p-3 hover:bg-gray-50 transition flex items-start justify-between gap-4";
        row.innerHTML = `
          <div class="min-w-0">
            <div class="font-medium text-gray-800 truncate">${s.name}</div>
            <div class="text-xs text-gray-500 truncate">${s.description || ""}</div>
            <div class="text-xs text-gray-400 truncate mt-1">${s.path}</div>
          </div>
          <div class="text-xs text-gray-500 whitespace-nowrap mt-1">Select</div>
        `;
        row.addEventListener("click", () => setSelectedScript(s));
        scriptList.appendChild(row);
      });

      if (scripts.length > 0) setSelectedScript(scripts[0]);
      else setSelectedScript(null);
    }

    async function loadScripts() {
      const res = await fetch("/api/scripts");
      const data = await res.json();
      const scripts = data.scripts || [];
      cachedScripts = scripts;
      renderScripts(scripts);
      return scripts;
    }

    async function fetchSessionStatus() {
      try {
        const res = await fetch("/api/session/status");
        const data = await res.json();
        if (!res.ok || !data.ok) return { running: false, command: "" };
        return { running: !!data.running, command: data.command || "" };
      } catch {
        return { running: false, command: "" };
      }
    }

    async function stopSessionBestEffort() {
      try {
        await fetch("/api/session/stop", { method: "POST" });
      } catch {
        // best-effort
      }
    }

    function enterSwitchMode() {
      switchMode = true;
      openScriptModal();

      // UX copy for switch mode (no disruption yet)
      if (scriptSelectedLabel) {
        scriptSelectedLabel.textContent =
          "Switch session: pick a script to start a new session. Current session will keep running until you click Start session.";
      }

      // Ensure list + CTA visible (fix “header + cancel only”)
      if (scriptList) scriptList.style.display = "";
      if (scriptStartBtn) scriptStartBtn.style.display = "";

      // Render from cache immediately (then refreshed in background if needed)
      if (cachedScripts && cachedScripts.length) renderScripts(cachedScripts);

      disable(scriptStartBtn, !selectedScript);

      timeline("Switch session opened. Cancel returns to your current session.", "info");
    }

    function exitSwitchModeReturnToSession() {
      switchMode = false;
      closeScriptModal();
      timeline("Switch cancelled. Returning to current session.", "info");
      setTimeout(() => term.focus(), 50);
    }

    async function startSelectedScript() {
      if (!selectedScript) return;

      disable(scriptStartBtn, true);

      try {
        // Commit point: ONLY now stop previous session (best practice)
        if (switchMode) {
          timeline("Stopping current session…", "info");
          await stopSessionBestEffort();
        }

        // Clear UI context for NEW session (requirement)
        try {
          term.reset();
        } catch {}
        clearAiChat({ greet: true });

        const res = await fetch("/api/session/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd: selectedScript.path }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

        switchMode = false;
        sessionStarted = true;
        setUiMode(UI_MODE.RUNNING, { commandLabel: selectedScript.name });
        closeScriptModal();

        timeline(`Started session: ${selectedScript.name}`, "success");
        setTimeout(() => term.focus(), 50);
      } catch (e) {
        timeline(`Failed to start session: ${String(e)}`, "error");
        disable(scriptStartBtn, false);
      }
    }

    function onCancelModal() {
      // In switch mode, Cancel must return to the active session (no stop).
      if (switchMode) return exitSwitchModeReturnToSession();
      closeScriptModal();
    }

    scriptCancelBtn?.addEventListener("click", onCancelModal);
    scriptCancelBtnX?.addEventListener("click", onCancelModal);
    scriptStartBtn?.addEventListener("click", startSelectedScript);

    // -----------------------------
    // State WS
    // -----------------------------
    wsState.addEventListener("message", (ev) => {
      const st = safeJSONParse(ev.data);
      if (!st) return;

      if (st.phase === "idle") {
        sessionStarted = false;
        // If user is switching, do not yank them out—let them decide.
        if (!switchMode) setUiMode(UI_MODE.WELCOME);
      } else {
        sessionStarted = true;
        // If user is switching, do not flip the UI mode under them.
        if (!switchMode) setUiMode(UI_MODE.RUNNING);
      }

      if (st.waiting_for_input) showBanner(st.prompt, st.choices);
      else hideBanner();

      if (st.completed) setStatus("Deployment completed.");
      else if (st.last_error) setStatus(`Error: ${st.last_error}`);
      else if (st.phase && !switchMode) setStatus(`Phase: ${st.phase}`);

      const summary = $("#summaryPre");
      if (summary) summary.textContent = JSON.stringify(st, null, 2);

      const issues = $("#issuesList");
      if (issues) {
        issues.innerHTML = "";
        const p = document.createElement("p");
        if (st.last_error) {
          p.className = "text-red-600";
          p.textContent = st.last_error;
        } else {
          p.className = "text-gray-500";
          p.textContent = "No issues detected.";
        }
        issues.appendChild(p);
      }

      // Optional enterprise UX: if a session just ended naturally, offer script picker.
      // (Does not stop anything; just makes it easy to start again.)
      if (st.phase === "idle" && uiMode === UI_MODE.RUNNING && !switchMode) {
        // Session ended; make next action obvious
        openScriptModal();
        timeline("Session ended. Choose a script to start a new session.", "info");
        setUiMode(UI_MODE.WELCOME);
      }
    });

    // -----------------------------
    // AI Chat
    // -----------------------------
    const aiInput = $("#aiInput");
    const aiSendBtn = $("#aiSendBtn");

    function setAiEnabled(on) {
      if (aiInput) aiInput.disabled = !on;
      if (aiSendBtn) aiSendBtn.disabled = !on;
      if (aiSendBtn) aiSendBtn.style.pointerEvents = on ? "auto" : "none";
      if (aiSendBtn) aiSendBtn.style.opacity = on ? "1" : "0.5";
    }

    function sendAI() {
      if (!aiInput) return;
      const q = aiInput.value.trim();
      if (!q) return;

      if (wsAI.readyState !== WebSocket.OPEN) {
        timeline("AI channel not connected.", "error");
        return;
      }

      aiInput.value = "";
      aiMessage(q, "user");
      wsAI.send(q);
    }

    aiSendBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendAI();
    });

    aiInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendAI();
      }
    });

    wsAI.addEventListener("open", () => {
      setAiEnabled(true);
      const feed = $("#aiFeed");
      if (feed && feed.children.length === 0) clearAiChat({ greet: true });
    });
    wsAI.addEventListener("close", () => setAiEnabled(false));
    wsAI.addEventListener("error", () => setAiEnabled(false));
    wsAI.addEventListener("message", (ev) => aiMessage(ev.data, "assistant"));

    setAiEnabled(false);

    // -----------------------------
    // Autopilot (BEST PRACTICE UX: telemetry to timeline, not assistant chat)
    // -----------------------------
    const autopilotBtn = $("#autopilotBtn");
    const autopilotPill = $("#autopilotPill");
    let autopilotOn = false;

    function updateAutopilot(on) {
      autopilotOn = on;
      if (autopilotBtn) {
        autopilotBtn.innerHTML = `<i class="fas fa-robot mr-2"></i> Autopilot: ${on ? "On" : "Off"}`;
      }
      if (autopilotPill) {
        autopilotPill.textContent = on ? "Autopilot On" : "Autopilot Off";
      }
    }

    autopilotBtn?.addEventListener("click", () => {
      if (wsAutopilot.readyState !== WebSocket.OPEN) return;
      wsAutopilot.send(JSON.stringify({ action: autopilotOn ? "stop" : "start" }));
    });

    wsAutopilot.addEventListener("message", (ev) => {
      const msg = safeJSONParse(ev.data);
      if (!msg) return;

      if (msg.type === "autopilot_status") updateAutopilot(!!msg.enabled);

      if (msg.type === "autopilot_event") {
        // Enterprise UX: autopilot is operational telemetry, not assistant content.
        timeline(
          `Autopilot: ${msg.event}${msg.error ? " | " + msg.error : ""}`,
          msg.error ? "error" : "info"
        );
      }
    });

    // -----------------------------
    // Export logs
    // -----------------------------
    $("#exportLogsBtn")?.addEventListener("click", () => {
      try {
        const text = termEl.innerText || "";
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `clouddeploy-logs-${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        timeline("Logs exported.", "success");
      } catch {
        timeline("Failed to export logs.", "error");
      }
    });

    // -----------------------------
    // End session (BEST PRACTICE UX):
    // - DOES NOT stop anything immediately
    // - Opens script picker in "switch mode"
    // - Cancel returns to current session
    // - Old session stops ONLY when user starts a new one
    // -----------------------------
    $("#endSessionBtn")?.addEventListener("click", async () => {
      if (uiMode !== UI_MODE.RUNNING) {
        openScriptModal();
        return;
      }

      // Ensure scripts list renders (fix “header + cancel only”)
      if (!cachedScripts || cachedScripts.length === 0) {
        try {
          await loadScripts();
        } catch (e) {
          timeline(`Failed to load scripts: ${String(e)}`, "error");
        }
      } else {
        renderScripts(cachedScripts);
      }

      enterSwitchMode();
    });

    // -----------------------------
    // Boot: load scripts, then if server already running, continue work.
    // -----------------------------
    try {
      await loadScripts();
      const status = await fetchSessionStatus();

      if (status.running) {
        sessionStarted = true;
        setUiMode(UI_MODE.RUNNING, { commandLabel: status.command || "Existing session" });
        closeScriptModal();
        timeline("Detected running session. Continuing…", "info");
      } else {
        sessionStarted = false;
        setUiMode(UI_MODE.WELCOME);
        openScriptModal();
        timeline("Choose a script to launch.", "info");
      }
    } catch (e) {
      timeline(`Failed to initialize scripts/status: ${String(e)}`, "error");
      setUiMode(UI_MODE.WELCOME);
      openScriptModal();
    }
  });
})();
