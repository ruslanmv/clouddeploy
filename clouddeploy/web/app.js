// clouddeploy/web/app.js
// Production-ready CloudDeploy frontend
// Requires xterm loaded globally via <script src=".../xterm.js"></script>

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
    if (!window.marked || !window.DOMPurify) return md; // Fallback to text if missing
    try {
      // Configure marked for better breaks if needed
      // window.marked.setOptions({ breaks: true }); 
      const rawHtml = window.marked.parse(md || "");
      return window.DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
    } catch (e) {
      console.error("Markdown render error:", e);
      return md;
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
      if (html) box.innerHTML = html;
      else box.textContent = text;
    } else {
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
        "Hi! I'm your CloudDeploy copilot. Start a session and I'll guide you step-by-step.",
        "assistant"
      );
    }
  }

  // ----------------------------------------------------------------------------
  // Robust WS creator
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
  // Settings Modal (FIXED: NO PAGE RELOAD)
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

    const inputs = {
      openai: {
        key: $("#openaiApiKey"),
        model: $("#openaiModel"),
        base: $("#openaiBaseUrl")
      },
      claude: {
        key: $("#claudeApiKey"),
        model: $("#claudeModel"),
        base: $("#claudeBaseUrl")
      },
      watsonx: {
        key: $("#watsonxApiKey"),
        project: $("#watsonxProjectId"),
        model: $("#watsonxModelId"),
        base: $("#watsonxBaseUrl")
      },
      ollama: {
        base: $("#ollamaBaseUrl"),
        model: $("#ollamaModel")
      }
    };

    let settings = null;
    let modelsCache = {};
    let saving = false;

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
      if (inputs.openai.key) inputs.openai.key.value = settings.openai?.api_key || "";
      if (inputs.openai.model) inputs.openai.model.value = settings.openai?.model || "";
      if (inputs.openai.base) inputs.openai.base.value = settings.openai?.base_url || "";

      // Claude
      if (inputs.claude.key) inputs.claude.key.value = settings.claude?.api_key || "";
      if (inputs.claude.model) inputs.claude.model.value = settings.claude?.model || "";
      if (inputs.claude.base) inputs.claude.base.value = settings.claude?.base_url || "";

      // Watsonx
      if (inputs.watsonx.key) inputs.watsonx.key.value = settings.watsonx?.api_key || "";
      if (inputs.watsonx.project) inputs.watsonx.project.value = settings.watsonx?.project_id || "";
      if (inputs.watsonx.model) inputs.watsonx.model.value = settings.watsonx?.model_id || "";
      if (inputs.watsonx.base) inputs.watsonx.base.value = settings.watsonx?.base_url || "";

      // Ollama
      if (inputs.ollama.base) inputs.ollama.base.value = settings.ollama?.base_url || "";
      if (inputs.ollama.model) inputs.ollama.model.value = settings.ollama?.model || "";

      showSection(p);
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

      disable(loadModelsBtn, true);
      showError("");

      try {
        const res = await fetch(`/api/settings/models?provider=${encodeURIComponent(p)}`);
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || "Failed to load models");

        modelsCache[p] = data.models || [];
        
        // Populate select
        if (modelsSelect) {
          modelsSelect.innerHTML = `<option value="">-- select a model --</option>`;
          modelsCache[p].forEach((m) => {
            const opt = document.createElement("option");
            opt.value = m;
            opt.textContent = m;
            modelsSelect.appendChild(opt);
          });
        }
        
        timeline(`Loaded ${modelsCache[p].length} models for ${p}`, "info");
      } catch (e) {
        showError(String(e?.message || e));
      } finally {
        disable(loadModelsBtn, false);
      }
    }

    function buildPatchFromForm() {
      if (!settings) return {};
      const p = settings.provider;
      const patch = { provider: p };
      const looksMasked = (v) => typeof v === "string" && (v.includes("***") || v === "***");

      if (p === "openai") {
        patch.openai = {
          ...(settings.openai || {}),
          model: inputs.openai.model?.value || "",
          base_url: inputs.openai.base?.value || "",
        };
        const k = inputs.openai.key?.value || "";
        if (k && !looksMasked(k)) patch.openai.api_key = k;
      }

      if (p === "claude") {
        patch.claude = {
          ...(settings.claude || {}),
          model: inputs.claude.model?.value || "",
          base_url: inputs.claude.base?.value || "",
        };
        const k = inputs.claude.key?.value || "";
        if (k && !looksMasked(k)) patch.claude.api_key = k;
      }

      if (p === "watsonx") {
        patch.watsonx = {
          ...(settings.watsonx || {}),
          project_id: inputs.watsonx.project?.value || "",
          model_id: inputs.watsonx.model?.value || "",
          base_url: inputs.watsonx.base?.value || "",
        };
        const k = inputs.watsonx.key?.value || "";
        if (k && !looksMasked(k)) patch.watsonx.api_key = k;
      }

      if (p === "ollama") {
        patch.ollama = {
          ...(settings.ollama || {}),
          base_url: inputs.ollama.base?.value || "",
          model: inputs.ollama.model?.value || "",
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
        fillFormFromSettings(); // refresh UI with server values
        showSaved("Saved ✅");
        timeline("LLM settings saved successfully.", "success");

        // Close modal after brief delay (no reload!)
        setTimeout(() => {
            close();
            showSaved(""); 
        }, 600);

      } catch (e) {
        showError(String(e?.message || e));
      } finally {
        saving = false;
        disable(saveBtn, false);
      }
    }

    btn?.addEventListener("click", async () => {
      open();
      await loadSettings();
    });
    closeBtn?.addEventListener("click", close);
    modal?.addEventListener("click", (e) => {
      if (e.target === modal) close();
    });
    providerSelect?.addEventListener("change", (e) => changeProvider(e?.target?.value));
    loadModelsBtn?.addEventListener("click", loadModels);
    
    modelsSelect?.addEventListener("change", (e) => {
      if (!settings) return;
      const p = settings.provider;
      const val = e.target.value;
      if(!val) return;
      
      if (p === "openai" && inputs.openai.model) inputs.openai.model.value = val;
      if (p === "claude" && inputs.claude.model) inputs.claude.model.value = val;
      if (p === "watsonx" && inputs.watsonx.model) inputs.watsonx.model.value = val;
      if (p === "ollama" && inputs.ollama.model) inputs.ollama.model.value = val;
    });

    saveBtn?.addEventListener("click", save);

    return { open, close, loadSettings };
  }

  // ----------------------------------------------------------------------------
  // AI "Plan → Approve → Execute" UI
  // ----------------------------------------------------------------------------
  function renderPlanCard(plan, { onApprove, onReject } = {}) {
    const feed = $("#aiFeed");
    if (!feed) return;

    const card = document.createElement("div");
    card.className = "rounded-xl border border-gray-200 bg-white p-4 shadow-sm";

    const title = document.createElement("div");
    title.className = "font-semibold text-gray-900";
    title.textContent = plan.title || "Proposed plan";
    card.appendChild(title);

    if (plan.notes) {
      const notes = document.createElement("div");
      notes.className = "mt-2 text-sm text-gray-700 prose prose-sm max-w-none";
      const html = renderMarkdownSafe(String(plan.notes));
      if (html != null) notes.innerHTML = html;
      else notes.textContent = String(plan.notes);
      card.appendChild(notes);
    }

    const list = document.createElement("div");
    list.className = "mt-3 space-y-2";
    (plan.steps || []).forEach((s, idx) => {
      const row = document.createElement("div");
      row.className = "rounded-lg border border-gray-200 bg-gray-50 p-3";

      const top = document.createElement("div");
      top.className = "flex items-start justify-between gap-3";

      const cmd = document.createElement("div");
      cmd.className = "font-mono text-xs text-gray-900 break-all";
      cmd.textContent = String(s.cmd || "");
      top.appendChild(cmd);

      const risk = document.createElement("span");
      const rk = String(s.risk || "low").toLowerCase();
      risk.className =
        rk === "high"
          ? "text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 whitespace-nowrap"
          : rk === "medium"
          ? "text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-800 whitespace-nowrap"
          : "text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 whitespace-nowrap";
      risk.textContent = `Risk: ${rk}`;
      top.appendChild(risk);

      row.appendChild(top);

      if (s.why) {
        const why = document.createElement("div");
        why.className = "mt-2 text-xs text-gray-700";
        why.textContent = `${idx + 1}. ${String(s.why)}`;
        row.appendChild(why);
      }

      list.appendChild(row);
    });
    card.appendChild(list);

    const btns = document.createElement("div");
    btns.className = "mt-4 flex items-center justify-end gap-2";

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className =
      "px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50";
    rejectBtn.textContent = "Reject";
    rejectBtn.addEventListener("click", () => onReject && onReject(plan, card));

    const approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.className =
      "px-3 py-2 rounded-lg bg-primary-blue text-white text-sm hover:opacity-95";
    approveBtn.textContent = "Approve & Run";
    approveBtn.addEventListener("click", () => onApprove && onApprove(plan, card, approveBtn));

    btns.appendChild(rejectBtn);
    btns.appendChild(approveBtn);
    card.appendChild(btns);

    feed.appendChild(card);
    feed.scrollTop = feed.scrollHeight;
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
      composer: $("#tab-composer"),
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
        
        // Hide all panels
        Object.keys(panels).forEach((k) => panels[k]?.classList.add("hidden"));
        // Show selected panel
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
    
    // Use FitAddon if available for better resizing
    let fitAddon = null;
    if (window.FitAddon && window.FitAddon.FitAddon) {
        fitAddon = new window.FitAddon.FitAddon();
        term.loadAddon(fitAddon);
    }
    
    term.open(termEl);
    if(fitAddon) fitAddon.fit();

    // Listen to resize events from the splitter logic
    window.addEventListener('resize', () => {
        if(fitAddon) fitAddon.fit();
    });

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
    let execActive = false;

    wsTerminalOut.addEventListener("open", () => setRuntimePill("Connected", true));
    wsTerminalOut.addEventListener("message", (ev) => term.write(ev.data));

    wsTerminalIn.addEventListener("open", () => (wsInReady = true));
    wsTerminalIn.addEventListener("close", () => (wsInReady = false));

    function canTypeTerminal() {
      return (
        uiMode === UI_MODE.RUNNING &&
        sessionStarted &&
        wsInReady &&
        wsTerminalIn.readyState === WebSocket.OPEN &&
        !execActive
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

      execActive = !!st.exec_active;

      if (st.phase === "idle") {
        sessionStarted = false;
        if (!switchMode) setUiMode(UI_MODE.WELCOME);
      } else {
        sessionStarted = true;
        if (!switchMode) setUiMode(UI_MODE.RUNNING);
      }

      if (execActive) {
        setStatus("Executing approved plan…");
      } else if (st.completed) {
        setStatus("Deployment completed.");
      } else if (st.last_error) {
        setStatus(`Error: ${st.last_error}`);
      } else if (st.phase && !switchMode) {
        setStatus(`Phase: ${st.phase}`);
      }

      if (st.waiting_for_input) showBanner(st.prompt, st.choices);
      else hideBanner();

      disable(quick1, !canTypeTerminal());
      disable(quick2, !canTypeTerminal());
      disable(quickEnter, !canTypeTerminal());

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

      if (st.phase === "idle" && uiMode === UI_MODE.RUNNING && !switchMode) {
        openScriptModal();
        timeline("Session ended. Choose a script to start a new session.", "info");
        setUiMode(UI_MODE.WELCOME);
      }
    });

    // -----------------------------
    // AI Chat + Plan approval
    // -----------------------------
    const aiInput = $("#aiInput");
    const aiSendBtn = $("#aiSendBtn");

    function ensureAiSendButton() {
      if ($("#aiSendBtn")) return $("#aiSendBtn");
      const wrap = aiInput?.parentElement;
      if (!wrap || !aiInput) return null;

      wrap.classList.add("flex", "items-center", "gap-2");
      aiInput.classList.add("flex-1");

      const b = document.createElement("button");
      b.id = "aiSendBtn";
      b.type = "button";
      b.className = "px-4 py-2 rounded-md bg-primary-blue text-white text-sm font-medium";
      b.textContent = "Send";
      wrap.appendChild(b);
      return b;
    }

    const ensuredSendBtn = ensureAiSendButton() || aiSendBtn;

    function setAiEnabled(on) {
      if (aiInput) aiInput.disabled = !on;
      if (ensuredSendBtn) ensuredSendBtn.disabled = !on;
      if (ensuredSendBtn) ensuredSendBtn.style.pointerEvents = on ? "auto" : "none";
      if (ensuredSendBtn) ensuredSendBtn.style.opacity = on ? "1" : "0.5";
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

    ensuredSendBtn?.addEventListener("click", (e) => {
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

    async function executePlan(plan, approveBtn, { autoApproved = false } = {}) {
      const steps = Array.isArray(plan.steps) ? plan.steps : [];
      if (steps.length === 0) return;

      execActive = true;
      if (approveBtn) {
        approveBtn.disabled = true;
        approveBtn.textContent = "Running…";
        approveBtn.classList.add("opacity-80");
      }

      const approvalMsg = autoApproved
        ? `🤖 Autopilot auto-approved: executing ${steps.length} step(s)…`
        : `Approved plan: executing ${steps.length} step(s)…`;

      timeline(approvalMsg, "info");

      if (autoApproved) {
        aiMessage("🤖 **Autopilot Mode:** Auto-executing plan now…", "assistant");
      } else {
        aiMessage("✅ Approved. Executing the plan now…", "assistant");
      }

      try {
        const res = await fetch("/api/plan/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ steps }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

        timeline(`Plan executed (${data.executed} steps).`, "success");
        aiMessage("✅ Done. Check the terminal output on the left.", "assistant");
      } catch (e) {
        timeline(`Plan execution failed: ${String(e?.message || e)}`, "error");
        aiMessage(`❌ Plan execution failed: ${String(e?.message || e)}`, "assistant");
      } finally {
        execActive = false;
        if (approveBtn) {
          approveBtn.disabled = false;
          approveBtn.textContent = "Approve & Run";
          approveBtn.classList.remove("opacity-80");
        }
      }
    }

    wsAI.addEventListener("open", () => {
      setAiEnabled(true);
      const feed = $("#aiFeed");
      if (feed && feed.children.length === 0) clearAiChat({ greet: true });
    });
    wsAI.addEventListener("close", () => setAiEnabled(false));
    wsAI.addEventListener("error", () => setAiEnabled(false));
    
    // --- UPDATED MESSAGE HANDLER TO FIX RENDERING BUGS ---
    wsAI.addEventListener("message", (ev) => {
      let raw = ev.data;
      if (typeof raw === "string") {
        // Remove markdown code blocks if present (common LLM artifact)
        raw = raw.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
      }

      const obj = safeJSONParse(raw);

      // If valid JSON object, handle it
      if (obj && typeof obj === "object") {
        if (obj.type === "message") {
          aiMessage(String(obj.markdown || ""), "assistant");
          return;
        }
        if (obj.type === "plan") {
          // ... (Plan handling logic same as before) ...
          if (autopilotOn) {
            timeline("🤖 Autopilot enabled: auto-approving plan…", "info");
            const stepsSummary = (obj.steps || [])
              .map((s, i) => `${i + 1}. \`${s.cmd}\` (${s.risk})`)
              .join("\n");
            aiMessage(
              `🤖 **Autopilot Plan: ${obj.title || "Proposed plan"}**\n\n${stepsSummary}\n\n_Auto-executing now…_`,
              "assistant"
            );
            executePlan(obj, null, { autoApproved: true });
          } else {
            renderPlanCard(obj, {
              onReject: () => {
                aiMessage("Plan rejected. Tell me what to change.", "assistant");
                timeline("Plan rejected by user.", "info");
              },
              onApprove: (plan, _card, approveBtn) => executePlan(plan, approveBtn, { autoApproved: false }),
            });
          }
          return;
        }
      } 
      
      // FALLBACK: If parsing failed, check if it LOOKS like the JSON message structure
      // and try to extract the markdown manually to prevent raw JSON display.
      if (typeof raw === "string" && raw.includes('"type": "message"') && raw.includes('"markdown":')) {
         try {
             // Basic regex extraction as last resort
             const match = raw.match(/"markdown":\s*"(.*)"/);
             if (match && match[1]) {
                 // Unescape basic json string chars
                 const content = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                 aiMessage(content, "assistant");
                 return;
             }
         } catch(e) {}
      }

      // Final fallback: treat as raw text
      aiMessage(raw, "assistant");
    });

    setAiEnabled(false);

    // -----------------------------
    // Autopilot
    // -----------------------------
    const autopilotBtn = $("#autopilotBtn");
    const autopilotPill = $("#autopilotPill");
    let autopilotOn = false;

    function updateAutopilot(on) {
      autopilotOn = on;
      if (autopilotBtn) {
        autopilotBtn.innerHTML = `<i class="fas fa-robot mr-2"></i> Autopilot: ${
          on ? "On" : "Off"
        }`;
      }
      if (autopilotPill) {
        autopilotPill.textContent = on ? "Autopilot On" : "Autopilot Off";
      }

      if (on) {
        timeline("🤖 Autopilot ON: AI plans will auto-execute without approval.", "success");
        aiMessage(
          "🤖 **Autopilot Mode Activated**\n\nI'll now automatically execute all plans without requiring your approval. You can still reject plans by disabling Autopilot.",
          "assistant"
        );
      } else {
        timeline("👤 Autopilot OFF: Manual approval required for all plans.", "info");
        aiMessage(
          "👤 **Manual Mode**\n\nI'll now ask for your approval before executing any plans.",
          "assistant"
        );
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