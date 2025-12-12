// clouddeploy/web/app.js
// Production-ready CloudDeploy frontend (no bundler)
// Requires xterm loaded globally via <script src=".../xterm.js"></script>
// For Markdown rendering in AI chat, include marked + DOMPurify in index.html.

(() => {
  const $ = (sel) => document.querySelector(sel);
  const wsProto = location.protocol === "https:" ? "wss" : "ws";
  const wsBase = `${wsProto}://${location.host}`;
  const nowTs = () => new Date().toISOString().replace("T", " ").replace("Z", "");

  // -----------------------------
  // Helpers
  // -----------------------------
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

  // -----------------------------
  // Markdown rendering (AI messages)
  // -----------------------------
  function renderMarkdownSafe(md) {
    // If libraries are missing, return null -> fallback to plain text
    if (!window.marked || !window.DOMPurify) return null;
    try {
      const rawHtml = window.marked.parse(md || "");
      // Sanitize to prevent XSS
      return window.DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
    } catch {
      return null;
    }
  }

  function aiMessage(text, who = "assistant") {
    const feed = $("#aiFeed");
    if (!feed) return;

    const box = document.createElement("div");
    box.className =
      who === "user"
        ? "rounded-lg border border-gray-200 p-3 bg-white text-sm text-gray-800"
        : "rounded-lg border border-gray-200 p-3 bg-gray-50 text-sm text-gray-800 prose prose-sm max-w-none";

    if (who === "assistant") {
      const html = renderMarkdownSafe(text);
      if (html != null) box.innerHTML = html;
      else box.textContent = text;
    } else {
      // user text must never be interpreted as HTML
      box.textContent = text;
    }

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

  // ----------------------------------------------------------------------------
  // Robust WS creator: if any websocket disconnects unexpectedly, force reload.
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

  // ----------------------------------------------------------------------------
  // Settings Modal (no React)
  // Requires index.html container:
  //  - #settingsBtn
  //  - #settingsModal (hidden by default)
  //  - #settingsCloseBtn
  //  - #settingsProviderSelect
  //  - #settingsLoadModelsBtn
  //  - #settingsModelsSelect
  //  - #settingsSaveBtn
  //  - #settingsErrorText
  //  - #settingsSavedText
  //  - provider-specific fields:
  //    openai: #openaiApiKey #openaiModel #openaiBaseUrl
  //    claude: #claudeApiKey #claudeModel #claudeBaseUrl
  //    watsonx: #watsonxApiKey #watsonxProjectId #watsonxModelId #watsonxBaseUrl
  //    ollama: #ollamaBaseUrl #ollamaModel
  //  - provider sections wrappers:
  //    #settingsOpenaiSection #settingsClaudeSection #settingsWatsonxSection #settingsOllamaSection
  // ----------------------------------------------------------------------------
  function createSettingsController() {
    const modal = $("#settingsModal");
    const btn = $("#settingsBtn");
    const closeBtn = $("#settingsCloseBtn");

    const providerSelect = $("#settingsProviderSelect");
    const loadModelsBtn = $("#settingsLoadModelsBtn");
    const modelsSelect = $("#settingsModelsSelect");

    const saveBtn = $("#settingsSaveBtn");
    const errText = $("#settingsErrorText");
    const savedText = $("#settingsSavedText");

    const sections = {
      openai: $("#settingsOpenaiSection"),
      claude: $("#settingsClaudeSection"),
      watsonx: $("#settingsWatsonxSection"),
      ollama: $("#settingsOllamaSection"),
    };

    // Inputs
    const openaiApiKey = $("#openaiApiKey");
    const openaiModel = $("#openaiModel");
    const openaiBaseUrl = $("#openaiBaseUrl");

    const claudeApiKey = $("#claudeApiKey");
    const claudeModel = $("#claudeModel");
    const claudeBaseUrl = $("#claudeBaseUrl");

    const watsonxApiKey = $("#watsonxApiKey");
    const watsonxProjectId = $("#watsonxProjectId");
    const watsonxModelId = $("#watsonxModelId");
    const watsonxBaseUrl = $("#watsonxBaseUrl");

    const ollamaBaseUrl = $("#ollamaBaseUrl");
    const ollamaModel = $("#ollamaModel");

    let settings = null;
    let modelsCache = {}; // { provider: [models...] }
    let saving = false;
    let loadingModels = false;

    function showError(msg) {
      if (errText) errText.textContent = msg || "";
    }
    function showSaved(msg) {
      if (savedText) savedText.textContent = msg || "";
      if (msg) setTimeout(() => showSaved(""), 2500);
    }

    function open() {
      if (!modal) return;
      modal.classList.remove("hidden");
      modal.classList.add("pointer-events-auto");
    }
    function close() {
      if (!modal) return;
      modal.classList.add("hidden");
    }

    function showSection(provider) {
      Object.keys(sections).forEach((k) => sections[k]?.classList.add("hidden"));
      sections[provider]?.classList.remove("hidden");
    }

    function getActiveModelValue(provider) {
      if (!settings) return "";
      if (provider === "openai") return settings.openai?.model || "";
      if (provider === "claude") return settings.claude?.model || "";
      if (provider === "watsonx") return settings.watsonx?.model_id || "";
      if (provider === "ollama") return settings.ollama?.model || "";
      return "";
    }

    function fillFormFromSettings() {
      if (!settings) return;
      const p = settings.provider;

      if (providerSelect) {
        providerSelect.innerHTML = "";
        (settings.providers || ["openai", "claude", "watsonx", "ollama"]).forEach((prov) => {
          const opt = document.createElement("option");
          opt.value = prov;
          opt.textContent = prov;
          providerSelect.appendChild(opt);
        });
        providerSelect.value = p;
      }

      // OpenAI
      if (openaiApiKey) openaiApiKey.value = settings.openai?.api_key || "";
      if (openaiModel) openaiModel.value = settings.openai?.model || "";
      if (openaiBaseUrl) openaiBaseUrl.value = settings.openai?.base_url || "";

      // Claude
      if (claudeApiKey) claudeApiKey.value = settings.claude?.api_key || "";
      if (claudeModel) claudeModel.value = settings.claude?.model || "";
      if (claudeBaseUrl) claudeBaseUrl.value = settings.claude?.base_url || "";

      // Watsonx
      if (watsonxApiKey) watsonxApiKey.value = settings.watsonx?.api_key || "";
      if (watsonxProjectId) watsonxProjectId.value = settings.watsonx?.project_id || "";
      if (watsonxModelId) watsonxModelId.value = settings.watsonx?.model_id || "";
      if (watsonxBaseUrl) watsonxBaseUrl.value = settings.watsonx?.base_url || "";

      // Ollama
      if (ollamaBaseUrl) ollamaBaseUrl.value = settings.ollama?.base_url || "";
      if (ollamaModel) ollamaModel.value = settings.ollama?.model || "";

      showSection(p);

      // Models select reset
      if (modelsSelect) {
        modelsSelect.innerHTML = `<option value="">-- select a model --</option>`;
        const cached = modelsCache[p] || [];
        cached.forEach((m) => {
          const opt = document.createElement("option");
          opt.value = m;
          opt.textContent = m;
          modelsSelect.appendChild(opt);
        });
        const active = getActiveModelValue(p);
        if (active) modelsSelect.value = active;
      }
    }

    async function loadSettings() {
      showError("");
      try {
        const res = await fetch("/api/settings");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load settings");
        settings = data;
        fillFormFromSettings();
      } catch (e) {
        showError(String(e?.message || e));
      }
    }

    async function changeProvider(provider) {
      if (!provider) return;
      showError("");
      showSaved("");
      try {
        const res = await fetch("/api/settings/provider", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to update provider");
        settings = data;
        fillFormFromSettings();
        timeline(`LLM provider set to: ${provider}`, "success");
      } catch (e) {
        showError(String(e?.message || e));
      }
    }

    async function loadModels() {
      if (!settings) return;
      const p = settings.provider;
      if (!p) return;

      loadingModels = true;
      disable(loadModelsBtn, true);
      showError("");

      try {
        const res = await fetch(`/api/settings/models?provider=${encodeURIComponent(p)}`);
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || "Failed to load models");

        modelsCache[p] = data.models || [];
        fillFormFromSettings();

        timeline(`Loaded ${modelsCache[p].length} models for ${p}`, "info");
      } catch (e) {
        showError(String(e?.message || e));
      } finally {
        loadingModels = false;
        disable(loadModelsBtn, false);
      }
    }

    function buildPatchFromForm() {
      if (!settings) return {};

      // NOTE: Your backend masks keys on GET, so user must re-enter keys to change them.
      // If user leaves masked value "***", we will NOT send it.
      const p = settings.provider;

      const patch = {
        provider: p,
      };

      const looksMasked = (v) => typeof v === "string" && (v.includes("***") || v === "***");

      if (p === "openai") {
        patch.openai = {
          ...(settings.openai || {}),
          model: openaiModel?.value || "",
          base_url: openaiBaseUrl?.value || "",
        };
        const k = openaiApiKey?.value || "";
        if (k && !looksMasked(k)) patch.openai.api_key = k;
      }

      if (p === "claude") {
        patch.claude = {
          ...(settings.claude || {}),
          model: claudeModel?.value || "",
          base_url: claudeBaseUrl?.value || "",
        };
        const k = claudeApiKey?.value || "";
        if (k && !looksMasked(k)) patch.claude.api_key = k;
      }

      if (p === "watsonx") {
        patch.watsonx = {
          ...(settings.watsonx || {}),
          project_id: watsonxProjectId?.value || "",
          model_id: watsonxModelId?.value || "",
          base_url: watsonxBaseUrl?.value || "",
        };
        const k = watsonxApiKey?.value || "";
        if (k && !looksMasked(k)) patch.watsonx.api_key = k;
      }

      if (p === "ollama") {
        patch.ollama = {
          ...(settings.ollama || {}),
          base_url: ollamaBaseUrl?.value || "",
          model: ollamaModel?.value || "",
        };
      }

      return patch;
    }

    async function save() {
      if (saving) return;
      saving = true;
      disable(saveBtn, true);
      showError("");
      showSaved("");

      try {
        const patch = buildPatchFromForm();
        const res = await fetch("/api/settings/llm", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to save settings");

        settings = data;
        fillFormFromSettings();
        showSaved("Settings saved.");

        timeline("LLM settings saved.", "success");

        // Enterprise-safe option: reload to guarantee fresh ws/ai provider
        // (If you prefer hot-swap without reload, you can close & recreate wsAI, but reload is safer.)
        setTimeout(() => location.reload(), 250);
      } catch (e) {
        showError(String(e?.message || e));
      } finally {
        saving = false;
        disable(saveBtn, false);
      }
    }

    // Wire UI events
    btn?.addEventListener("click", async () => {
      open();
      await loadSettings();
    });

    closeBtn?.addEventListener("click", close);

    // Click outside to close (optional)
    modal?.addEventListener("click", (e) => {
      if (e.target === modal) close();
    });

    providerSelect?.addEventListener("change", (e) => {
      const val = e.target?.value;
      changeProvider(val);
    });

    loadModelsBtn?.addEventListener("click", loadModels);

    modelsSelect?.addEventListener("change", (e) => {
      if (!settings) return;
      const p = settings.provider;
      const model = e.target?.value || "";

      // Apply into correct input so Save will persist it
      if (p === "openai" && openaiModel) openaiModel.value = model;
      if (p === "claude" && claudeModel) claudeModel.value = model;
      if (p === "watsonx" && watsonxModelId) watsonxModelId.value = model;
      if (p === "ollama" && ollamaModel) ollamaModel.value = model;
    });

    saveBtn?.addEventListener("click", save);

    return { open, close, loadSettings };
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
    const UI_MODE = { WELCOME: "WELCOME", RUNNING: "RUNNING" };
    let uiMode = UI_MODE.WELCOME;

    function setUiMode(next, { commandLabel = "" } = {}) {
      uiMode = next;
      setRuntimePill("Connected", true);
      if (next === UI_MODE.WELCOME) setStatus("Pick a script to start.");
      else setStatus(commandLabel ? `Running: ${commandLabel}` : "Running session…");
    }

    // -----------------------------
    // Settings modal controller
    // -----------------------------
    // Safe to create even if modal isn't in DOM; it just won't do anything.
    createSettingsController();

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
      return uiMode === UI_MODE.RUNNING && sessionStarted && wsInReady && wsTerminalIn.readyState === WebSocket.OPEN;
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
    let switchMode = false;

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
      if (scriptSelectedLabel) {
        scriptSelectedLabel.textContent =
          "Switch session: pick a script to start a new session. Current session will keep running until you click Start session.";
      }
      if (scriptList) scriptList.style.display = "";
      if (scriptStartBtn) scriptStartBtn.style.display = "";
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
        if (switchMode) {
          timeline("Stopping current session…", "info");
          await stopSessionBestEffort();
        }

        // New session = clean context
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
        if (!switchMode) setUiMode(UI_MODE.WELCOME);
      } else {
        sessionStarted = true;
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

      // Session ended naturally: make next action obvious (but do not kill anything)
      if (st.phase === "idle" && uiMode === UI_MODE.RUNNING && !switchMode) {
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
    // Autopilot (telemetry -> timeline)
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
        timeline(`Autopilot: ${msg.event}${msg.error ? " | " + msg.error : ""}`, msg.error ? "error" : "info");
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
    // End session = switch mode
    // -----------------------------
    $("#endSessionBtn")?.addEventListener("click", async () => {
      if (uiMode !== UI_MODE.RUNNING) {
        openScriptModal();
        return;
      }

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
    // Boot
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
