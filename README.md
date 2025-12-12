# CloudDeploy 🚀🤖🖥️  
**Terminal + AI Workspace for Cloud Deployments (Local-First, Enterprise-Ready)**

![Python](https://img.shields.io/badge/Python-3.11%2B-blue?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-API-009688?logo=fastapi&logoColor=white)
![WebSockets](https://img.shields.io/badge/WebSockets-Real--time-6c5ce7)
![License](https://img.shields.io/badge/License-Apache--2.0-green)
![Open Source](https://img.shields.io/badge/Open%20Source-Yes-orange)

If you’ve ever lost hours to “works on my machine” deployments, interactive CLIs, missing env vars, or confusing cloud logs — **CloudDeploy** is for you.

CloudDeploy is a **local workspace** that runs your **real interactive deployment CLI** in a browser (left panel), while an **AI deployment copilot** (right panel) explains what’s happening, flags issues early, and suggests next actions — with an optional **Autopilot** mode that can safely drive wizard prompts under guardrails.

⭐ If CloudDeploy saves you even one deployment incident, please **star the repo**.

---

## ✨ Highlights

- 🖥️ **Real Terminal in the Browser** (PTY-backed, not fake logs)
- 🔁 **Live Streaming Output** + prompt detection
- 🤖 **AI Copilot** reads **sanitized** terminal tail + state
- 🛡️ **Autopilot (Guardrailed)** for safe wizard-style prompts
- 🧰 **MCP Tool Server** (same tool layer powers UI + agents)
- 🧾 **Audit-Friendly UX**: timeline, summary, issues
- 🔌 **Provider-Extensible** (prompt maps + automation modules)

---

## 🧠 What is CloudDeploy?

CloudDeploy combines three things into one workflow:

### 1) Web Workspace (Terminal + AI)
- Runs a real PTY-backed terminal session in your browser
- Streams logs live
- Detects wizard prompts & steps automatically
- Shows status / summary / issues in a clean enterprise UI

### 2) AI Copilot for Deployments
- Reads **sanitized** terminal output (redaction by default)
- Explains current step in plain language
- Suggests the safest next action
- Helps troubleshoot failures with actionable hints

### 3) MCP Server (Tooling Interface)
- Exposes the deployment session as tools (stdio MCP)
- Enables external agents/orchestrators to observe, reason, and optionally automate
- **Same tool layer powers UI Autopilot** — no duplicated automation systems

> **v1 focus:** IBM Cloud Container Registry + Code Engine deployment wizards  
> **Roadmap:** multi-cloud providers, reusable prompt maps, enterprise policy packs, audit trails

---

## 🏢 Why teams adopt CloudDeploy (Enterprise mindset)

- 👩‍💻 **Zero-to-hero onboarding:** consistent wizard experience across engineers
- 🔥 **Incident reduction:** step detection + AI explanations reduce “unknown unknowns”
- 🧾 **Audit-friendly:** timeline, step snapshots, and policy-guarded actions
- 🛡️ **Safe automation:** autopilot answers wizard prompts, stops on errors
- 🧩 **Extensible:** add providers via prompt maps + automation modules

---

## 📦 Install

```bash
pip install clouddeploy
````

CloudDeploy runs locally and uses **your system tools** (Docker/CLIs/etc).
No vendor lock-in: the AI provider is configurable.

---

## ✅ Prerequisites

### System Requirements

* Python **3.11+**
* macOS / Linux recommended (PTY-based runner)
* Windows: supported via **WSL2** (recommended)

### IBM Cloud Requirements (v1)

Ensure these are available in your `PATH`:

* `ibmcloud` CLI
* `docker`
* `jq`

Permissions needed:

* Container Registry access
* Code Engine project access
* IAM API key creation (optional; only if using auto-key creation flow)

---

## 🚀 Quick Start

### 1) Run the Web Workspace (Terminal + AI)

Launches a browser workspace where:

* Left = real CLI wizard running in a PTY
* Right = AI assistant (Assistant / Summary / Issues)
* Top = status + **Autopilot toggle**

```bash
clouddeploy ui --cmd ./scripts/push_to_code_engine.sh --host 127.0.0.1 --port 8787
```

Open:

* [http://127.0.0.1:8787](http://127.0.0.1:8787)

> Tip: You can run **any** interactive CLI wizard — detection is pluggable.

---

## 🧭 UX: Ending / Switching Sessions (Best Practice)

CloudDeploy follows an enterprise-safe pattern:

* Clicking **End Session** opens a **Switch Session** picker
* **Cancel** returns to the current session (nothing is stopped)
* The current session is stopped **only when you click “Start session”** for a new script
  (commit point prevents accidental termination)

This prevents “oops I clicked End Session” incidents and supports rapid restarts.

---

## 🤖 Autopilot (Policy-Guarded Automation)

CloudDeploy includes an **Autopilot** toggle inside the UI.

Autopilot is intentionally conservative:

* Prefers defaults (**ENTER**)
* Uses safe yes/no answers (`Y` / `n`)
* Selects numeric choices when clearly detected
* **Stops on errors** (does not guess destructive fixes)

Autopilot runs through the same internal tool registry used by MCP tools — evolve automation once.

### 🛡️ Safety guardrails

Autopilot and MCP input are filtered through a policy engine:

* Blocks dangerous patterns (`rm -rf`, shutdown, destructive payloads, etc.)
* In strict mode, only allows wizard-style inputs (ENTER, `Y/n`, numbers)

---

## 🔧 Run as an MCP Server (stdio)

CloudDeploy can run as a **tool server** for external agents:

```bash
clouddeploy mcp --cmd ./scripts/push_to_code_engine.sh
```

Example tool call (read sanitized tail output):

```bash
echo '{"id":"1","tool":"cli.read","args":{"tail_chars":1200,"redact":true}}' \
  | clouddeploy mcp --cmd ./scripts/push_to_code_engine.sh
```

This enables:

* agent-driven observability
* enterprise orchestration integrations
* automated pipelines with human approvals

---

## 🔌 LLM Provider Configuration

CloudDeploy uses a provider abstraction (`clouddeploy/llm/llm_provider.py`) and supports:

* **watsonx.ai** (default, recommended)
* OpenAI
* Claude (Anthropic)
* Ollama (local)

### ✅ watsonx.ai (Recommended)

```bash
export GITPILOT_PROVIDER=watsonx
export WATSONX_API_KEY="YOUR_KEY"
export WATSONX_PROJECT_ID="YOUR_PROJECT_ID"

# Optional overrides
export WATSONX_BASE_URL="https://us-south.ml.cloud.ibm.com"
export GITPILOT_WATSONX_MODEL="ibm/granite-3-8b-instruct"
```

### OpenAI

```bash
export GITPILOT_PROVIDER=openai
export OPENAI_API_KEY="YOUR_KEY"
export GITPILOT_OPENAI_MODEL="gpt-4o-mini"

# Optional
export OPENAI_BASE_URL="https://api.openai.com"
```

### Claude (Anthropic)

```bash
export GITPILOT_PROVIDER=claude
export ANTHROPIC_API_KEY="YOUR_KEY"
export GITPILOT_CLAUDE_MODEL="claude-sonnet-4-5"

# Optional
export ANTHROPIC_BASE_URL="https://api.anthropic.com"
```

### Ollama (Local)

```bash
export GITPILOT_PROVIDER=ollama
export OLLAMA_BASE_URL="http://localhost:11434"
export GITPILOT_OLLAMA_MODEL="llama3"
```

---

## 🔐 Security & Compliance Notes (Important)

CloudDeploy is designed for enterprise usage:

### 🧼 Redaction by default

Terminal logs sent to the AI are sanitized (`clouddeploy/redact.py`):

* masks API keys, tokens, passwords
* masks Bearer tokens
* can optionally redact `.env` values while keeping keys

### 🛡️ Policy-guarded automation

Automation is gated (`clouddeploy/mcp/policy.py`):

* blocks destructive patterns
* strict mode restricts to safe wizard responses

### 🏠 Local-first

You run CloudDeploy locally; it uses the same credentials/tools you already use:

* no credential harvesting
* no remote terminal execution layer required

> Best practice: use least-privilege IAM keys and managed secret stores.

---

## 🧱 Project Structure

```text
clouddeploy/
  server.py                # FastAPI app + WebSockets + session endpoints
  web/
    index.html             # UI shell (no bundler)
    app.js                 # UI logic (xterm + websockets + switch-session UX)
    styles.css             # UI styles
  mcp/
    tools.py               # ToolRegistry interface (CLI read/send/state)
    policy.py              # Input guardrails
  llm/
    llm_provider.py        # Provider abstraction
    prompts.py             # System + status prompts
  ibm/
    automation.py          # IBM-specific autopilot heuristics
scripts/
  push_to_code_engine.sh   # Example deployment script
```

---

## 🧪 Development (uv-only workflows)

CloudDeploy uses **uv** for fast, reproducible installs.

```bash
make sync
make run-ui CMD=./scripts/push_to_code_engine.sh
make test
make lint
```

---

## 🧩 Contributing

We welcome PRs for:

* new cloud provider prompt maps
* improved step detection rules
* better policy packs
* UI enhancements
* wizard regression samples

Guidelines:

* keep automation conservative (safe-by-default)
* never leak secrets; respect redaction
* prefer deterministic state detection over heuristics

---

## 🆘 Support / Community

If you hit a tricky deployment edge-case:

* capture sanitized logs (Export Logs button)
* open an issue with the step + error section
* or propose a new prompt map rule

⭐ If CloudDeploy helps your team ship faster, please **star the repo** — it drives adoption and accelerates multi-cloud support.

---

## 📜 License

Apache 2.0 — see `LICENSE`.


