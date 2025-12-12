# CloudDeploy 🚀 (Terminal + AI Workspace for Cloud Deployments)

If you’ve ever lost hours to “it works on my machine” deployments, interactive CLIs, missing env vars, or confusing cloud logs — **CloudDeploy** is for you.

CloudDeploy is an **enterprise-grade local workspace** that runs your **real interactive deployment CLI** in a browser (left panel), while an **AI deployment copilot** (right panel) explains what’s happening, flags issues early, and suggests next actions — with an optional **Autopilot** mode that can safely drive wizard prompts under guardrails.

⭐ If CloudDeploy saves you even one deployment incident, **please star the repo** — it helps us ship multi-cloud faster.

---

## What is CloudDeploy?

CloudDeploy combines three things into one workflow:

1) **Web Workspace (Terminal + AI)**
- Runs a real PTY-backed terminal session in your browser.
- Streams logs live.
- Detects wizard prompts & steps automatically.
- Shows status / summary / issues in an enterprise UI.

2) **AI Copilot for Deployments**
- Reads the *sanitized* live terminal output.
- Explains the current step in plain language.
- Suggests the safest next action.
- Helps troubleshoot failures with actionable hints.

3) **MCP Server (Tooling Interface)**
- Exposes the deployment session as tools (stdio MCP).
- Enables external agents / orchestrators to observe, reason, and (optionally) automate.
- Same tool layer powers both MCP and UI Autopilot — **no duplicated automation systems**.

> **v1 focus:** IBM Cloud Container Registry + Code Engine deployment wizards  
> **Roadmap:** multi-cloud providers, reusable prompt maps, enterprise policy packs, audit trails

---

## Why teams adopt CloudDeploy (Enterprise mindset)

- **Zero-to-hero onboarding:** consistent wizard experience for every engineer
- **Incident reduction:** step detection + AI explanations reduce “unknown unknowns”
- **Audit-friendly:** timeline, step snapshots, and policy-guarded actions
- **Safe automation:** Autopilot only answers wizard-style prompts; stops on errors
- **Extensible:** add providers via prompt maps + automation modules

---

## Install

```bash
pip install clouddeploy
````

CloudDeploy runs locally and uses **your system tools** (Docker, IBM CLI, jq).
No vendor lock-in: the AI provider is configurable.

---

## Prerequisites

### System Requirements

* Python 3.11+
* macOS / Linux recommended (PTY-based terminal runner)
* Windows: supported via WSL2 (recommended)

### IBM Cloud Requirements (v1)

You must have these available in your PATH:

* `ibmcloud` CLI
* `docker`
* `jq`

You also need IBM Cloud permissions for:

* Container Registry access
* Code Engine project access
* IAM API key creation (optional, only if you use auto-key creation flow)

---

## Quick Start

### 1) Run the Web Workspace (Terminal + AI)

This launches a browser workspace where:

* Left = real CLI wizard running in a PTY
* Right = AI assistant (Assistant / Summary / Issues)
* Top = status + **Autopilot toggle**

```bash
clouddeploy ui --cmd ./scripts/push_to_code_engine.sh --host 127.0.0.1 --port 8787
```

Open:

* [http://127.0.0.1:8787](http://127.0.0.1:8787)

> Tip: You can run **any** interactive CLI wizard, not just IBM — detection is pluggable.

---

## Autopilot (Policy-Guarded Automation)

CloudDeploy includes an **Autopilot** toggle inside the UI.

Autopilot is intentionally conservative:

* Prefers defaults (ENTER)
* Uses safe yes/no answers (`Y`/`n`)
* Selects numeric choices when clearly detected
* **Stops on errors** (does not guess destructive fixes)

Autopilot runs through the same internal tool registry used by MCP tools — so you can evolve automation once.

### Safety guardrails

Autopilot and MCP input are filtered through a policy engine:

* Blocks dangerous patterns (`rm -rf`, shutdown, destructive shell payloads, etc.)
* In strict mode, only allows wizard-style inputs (ENTER, `Y/n`, numbers)

---

## Run as an MCP Server (stdio)

CloudDeploy can run as a **tool server** for external agents.

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

## LLM Provider Configuration

CloudDeploy uses a provider abstraction (`clouddeploy/llm/llm_provider.py`) and supports:

* **watsonx.ai** (default, recommended)
* OpenAI
* Claude (Anthropic)
* Ollama (local)

### Default: watsonx.ai (Recommended)

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

## Security & Compliance Notes (Important)

CloudDeploy is designed for enterprise usage:

* **Redaction by default:** terminal logs sent to AI are sanitized (`clouddeploy/redact.py`)

  * masks API keys, tokens, passwords
  * masks Bearer tokens
  * can optionally redact `.env` values while keeping keys

* **Policy-guarded automation:** automated input is gated (`clouddeploy/mcp/policy.py`)

  * blocks destructive patterns
  * strict mode restricts input to safe wizard responses

* **Local-first:** you run CloudDeploy locally; it uses the same credentials/tools you already use

  * no credential harvesting
  * no remote terminal execution layer required

> Best practice: use least-privilege IAM keys and keep secrets in managed secret stores where possible.

---

## Multi-Cloud Vision (What’s next)

CloudDeploy is built to scale across providers without rewriting the UI:

* Provider modules: `clouddeploy/<provider>/prompt_map.py`
* Autopilot engines: `clouddeploy/<provider>/automation.py`
* Shared tool layer (UI + MCP): `clouddeploy/mcp/tools.py`
* Shared state detection: `clouddeploy/step_detector.py`

**Planned providers:**

* AWS (ECS/Fargate, ECR)
* Azure (Container Apps, ACR)
* GCP (Cloud Run, Artifact Registry)
* Kubernetes (Helm-based guided deployments)

---

## Development (uv-only workflows)

CloudDeploy uses **uv** for fast, reproducible installs.

```bash
make sync
make run-ui CMD=./scripts/push_to_code_engine.sh
make test
make lint
```

---

## Contributing

We welcome:

* new cloud provider prompt maps
* improved step detection rules
* better policy packs
* UI enhancements
* regression samples for wizards

If you’re deploying agents, services, or MCP servers and want a reliable “zero-to-hero” workflow, CloudDeploy is the platform.

---

## Support / Community

If you hit a tricky deployment edge-case:

* capture the sanitized logs (Export Logs button)
* open an issue with the step + error section
* or propose a new prompt map rule

⭐ And again: if CloudDeploy helps your team ship faster, **please star the repo** — it drives adoption and accelerates multi-cloud support.

---

## License

Apache 2.0 — see `LICENSE`.
