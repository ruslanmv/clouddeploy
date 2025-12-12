SHELL := /bin/bash
.ONESHELL:
.SHELLFLAGS := -eu -o pipefail -c

UV ?= uv
PYTHON_VERSION ?= 3.11

HOST ?= 127.0.0.1
PORT ?= 8787
CMD ?= ./scripts/push_to_code_engine.sh

.PHONY: help
help:
	@echo "CloudDeploy targets (uv-only):"
	@echo ""
	@echo "  make install     Install Python $(PYTHON_VERSION), create venv, sync deps, install project (editable)"
	@echo "  make run         Run Web UI (terminal + AI) on http://$(HOST):$(PORT)"
	@echo "  make mcp         Run MCP server (stdio) using CMD=$(CMD)"
	@echo "  make test        Run tests"
	@echo "  make lint        Ruff lint"
	@echo "  make format      Ruff format"
	@echo "  make build       Build wheel/sdist"
	@echo "  make clean       Remove venv + build artifacts"
	@echo ""
	@echo "Variables:"
	@echo "  PYTHON_VERSION=$(PYTHON_VERSION)"
	@echo "  HOST=$(HOST)  PORT=$(PORT)"
	@echo "  CMD=$(CMD)"

.PHONY: install
install:
	$(UV) python install $(PYTHON_VERSION)
	$(UV) venv --python $(PYTHON_VERSION)
	$(UV) sync --dev
	# Ensure the local project itself is importable inside the env (editable install)
	$(UV) pip install -e .

.PHONY: run
run: install
	# Most reliable: run as a module so imports always work
	$(UV) run python -m clouddeploy ui --host $(HOST) --port $(PORT) --cmd "$(CMD)"

.PHONY: mcp
mcp: install
	@echo "MCP server running over stdio."
	@echo 'Example: echo "{\"id\":\"1\",\"tool\":\"cli.read\",\"args\":{}}" | $(UV) run python -m clouddeploy mcp --cmd "$(CMD)"'
	$(UV) run python -m clouddeploy mcp --cmd "$(CMD)"

.PHONY: test
test: install
	$(UV) run pytest -q

.PHONY: lint
lint: install
	$(UV) run ruff check .

.PHONY: format
format: install
	$(UV) run ruff format .
	$(UV) run ruff check . --fix

.PHONY: build
build: install
	$(UV) build

.PHONY: clean
clean:
	rm -rf .venv dist build .pytest_cache .ruff_cache .mypy_cache htmlcov .coverage
	find . -type d -name "__pycache__" -prune -exec rm -rf {} \;
	find . -type f -name "*.pyc" -delete
