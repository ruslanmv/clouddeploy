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

  function setStatus(text) {
    const el = $("#statusCardText");
    if (el) el.textContent = text;
  }

  function setRuntimePill(text, ok = true) {
    const pill = $("#runtimePill");
    if (!pill) return;
    pill.innerHTML = `<span class="w-2 h-2 rounded-full ${ok ? "bg-status-running" : "bg-red-500"} mr-2"></span>${text}`;
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
    // WebSockets
    // -----------------------------
    const wsTerminalOut = new WebSocket(`${wsBase}/ws/terminal`);
    const wsTerminalIn = new WebSocket(`${wsBase}/ws/terminal_input`);
    const wsState = new WebSocket(`${wsBase}/ws/state`);
    const wsAI = new WebSocket(`${wsBase}/ws/ai`);
    const wsAutopilot = new WebSocket(`${wsBase}/ws/autopilot`);

    let wsInReady = false;
    let sessionStarted = false;

    // Only allow user typing after session has started
    function canTypeTerminal() {
      return wsInReady && sessionStarted && wsTerminalIn.readyState === WebSocket.OPEN;
    }

    function sendToTerminal(data, { submit = false } = {}) {
      if (!canTypeTerminal()) return false;
      const payload = submit ? `${data}\r` : data;
      term.focus();
      wsTerminalIn.send(payload);
      return true;
    }

    wsTerminalOut.onopen = () => {
      timeline("Terminal output connected.", "success");
      setRuntimePill("Connected", true);
      setStatus("Pick a script to start.");
    };
    wsTerminalOut.onmessage = (ev) => term.write(ev.data);
    wsTerminalOut.onerror = () => setRuntimePill("Output WS error", false);
    wsTerminalOut.onclose = () => setRuntimePill("Disconnected", false);

    wsTerminalIn.onopen = () => {
      wsInReady = true;
      timeline("Terminal input connected.", "success");
    };
    wsTerminalIn.onclose = () => (wsInReady = false);

    // Forward xterm keys (but ONLY after session started)
    term.onData((data) => {
      if (!canTypeTerminal()) return;
      wsTerminalIn.send(data);
    });

    // -----------------------------
    // Prompt banner quick actions
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

      // If session not started yet, disable banner actions
      disable(quick1, !sessionStarted);
      disable(quick2, !sessionStarted);
      disable(quickEnter, !sessionStarted);
    }

    function hideBanner() {
      banner?.classList.add("hidden");
    }

    // Don't steal Enter if user is typing in AI input
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const active = document.activeElement;
      if (active && active.id === "aiInput") return;
      if (!banner || banner.classList.contains("hidden")) return;
      e.preventDefault();
      sendToTerminal("", { submit: true });
    });

    // -----------------------------
    // State WS
    // -----------------------------
    wsState.onmessage = (ev) => {
      const st = JSON.parse(ev.data);

      if (st.phase === "idle") {
        // no session yet
        sessionStarted = false;
        setStatus("Pick a script to start.");
      } else {
        sessionStarted = true;
      }

      if (st.waiting_for_input) showBanner(st.prompt, st.choices);
      else hideBanner();

      if (st.completed) setStatus("Deployment completed.");
      else if (st.last_error) setStatus(`Error: ${st.last_error}`);
      else if (st.phase) setStatus(`Phase: ${st.phase}`);

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
    };

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

    function openScriptModal() {
      scriptModal?.classList.remove("hidden");
      // ensure clicks go through even with terminal underneath
      scriptModal?.classList.add("pointer-events-auto");
    }
    function closeScriptModal() {
      scriptModal?.classList.add("hidden");
    }
    function setSelectedScript(s) {
      selectedScript = s;
      if (scriptSelectedLabel) scriptSelectedLabel.textContent = s ? `Selected: ${s.name}` : "No script selected";
      disable(scriptStartBtn, !s);
    }

    async function loadScripts() {
      const res = await fetch("/api/scripts");
      const data = await res.json();
      const scripts = data.scripts || [];
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

    async function startSelectedScript() {
      if (!selectedScript) return;

      disable(scriptStartBtn, true);

      try {
        const res = await fetch("/api/session/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd: selectedScript.path }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

        sessionStarted = true;
        closeScriptModal();
        timeline(`Started session: ${selectedScript.name}`, "success");
        setStatus(`Running: ${selectedScript.name}`);

        // let server print initial output
        setTimeout(() => term.focus(), 50);
      } catch (e) {
        timeline(`Failed to start session: ${String(e)}`, "error");
        disable(scriptStartBtn, false);
      }
    }

    scriptCancelBtn?.addEventListener("click", closeScriptModal);
    scriptCancelBtnX?.addEventListener("click", closeScriptModal);
    scriptStartBtn?.addEventListener("click", startSelectedScript);

    // show modal BEFORE any session is started
    try {
      await loadScripts();
      openScriptModal();
      setRuntimePill("Connected", true);
      timeline("Choose a script to launch.", "info");
    } catch (e) {
      timeline(`Failed to load scripts: ${String(e)}`, "error");
      openScriptModal();
    }

    // -----------------------------
    // AI Chat (fix “Send frozen”)
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

    // Ensure button click always triggers
    aiSendBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendAI();
    });

    // Enter in input sends
    aiInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendAI();
      }
    });

    wsAI.onopen = () => {
      setAiEnabled(true);
      timeline("AI channel connected.", "success");
      aiMessage("Hi! Pick a script to start, then ask me anything.", "assistant");
    };
    wsAI.onclose = () => setAiEnabled(false);
    wsAI.onerror = () => {
      setAiEnabled(false);
      timeline("AI websocket error.", "error");
    };
    wsAI.onmessage = (ev) => aiMessage(ev.data, "assistant");

    // Start disabled until ws opens
    setAiEnabled(false);

    // -----------------------------
    // Autopilot
    // -----------------------------
    const autopilotBtn = $("#autopilotBtn");
    const autopilotPill = $("#autopilotPill");
    let autopilotOn = false;

    function updateAutopilot(on) {
      autopilotOn = on;
      if (autopilotBtn) autopilotBtn.innerHTML = `<i class="fas fa-robot mr-2"></i> Autopilot: ${on ? "On" : "Off"}`;
      if (autopilotPill) autopilotPill.textContent = on ? "Autopilot On" : "Autopilot Off";
    }

    autopilotBtn?.addEventListener("click", () => {
      if (wsAutopilot.readyState !== WebSocket.OPEN) return;
      wsAutopilot.send(JSON.stringify({ action: autopilotOn ? "stop" : "start" }));
    });

    wsAutopilot.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "autopilot_status") updateAutopilot(!!msg.enabled);
      if (msg.type === "autopilot_event") {
        aiMessage(`🤖 ${msg.event}${msg.error ? " | " + msg.error : ""}`, "assistant");
        timeline(`Autopilot event: ${msg.event}`, "info");
      }
    };

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
    // End session
    // -----------------------------
    $("#endSessionBtn")?.addEventListener("click", () => {
      timeline("Disconnecting…", "info");
      try { wsTerminalOut.close(); } catch {}
      try { wsTerminalIn.close(); } catch {}
      try { wsState.close(); } catch {}
      try { wsAI.close(); } catch {}
      try { wsAutopilot.close(); } catch {}
      setStatus("Disconnected. Refresh to reconnect.");
      setRuntimePill("Disconnected", false);
    });
  });
})();
