SHELL := /bin/bash
.ONESHELL:
.SHELLFLAGS := -eu -o pipefail -c

PYTHON_VERSION ?= 3.11
APP ?= clouddeploy
HOST ?= 127.0.0.1
PORT ?= 8787
CMD ?= ./scripts/push_to_code_engine.sh

# uv is required
UV ?= uv

.PHONY: help
help:
	@echo "CloudDeploy (uv-only) targets:"
	@echo "  make venv         - create .venv with Python $(PYTHON_VERSION)"
	@echo "  make sync         - sync dependencies (dev) into .venv"
	@echo "  make run-ui       - run web workspace (terminal + AI)"
	@echo "  make run-mcp      - run MCP server over stdio (with --cmd)"
	@echo "  make format       - format with ruff"
	@echo "  make lint         - lint with ruff"
	@echo "  make test         - run pytest"
	@echo "  make build        - build wheel/sdist"
	@echo "  make publish-test - publish to testpypi (requires twine config)"
	@echo "  make publish      - publish to pypi (requires twine config)"
	@echo ""
	@echo "Variables:"
	@echo "  PYTHON_VERSION=$(PYTHON_VERSION)"
	@echo "  HOST=$(HOST) PORT=$(PORT) CMD=$(CMD)"

.PHONY: venv
venv:
	$(UV) venv --python $(PYTHON_VERSION)

.PHONY: sync
sync: venv
	$(UV) sync --dev

.PHONY: run-ui
run-ui: sync
	$(UV) run $(APP) ui --host $(HOST) --port $(PORT) --cmd "$(CMD)"

.PHONY: run-mcp
run-mcp: sync
	@echo "Starting MCP server (stdio). Example usage:"
	@echo '  echo "{\"id\":\"1\",\"tool\":\"cli.read\",\"args\":{}}" | $(UV) run $(APP) mcp --cmd "$(CMD)"'
	$(UV) run $(APP) mcp --cmd "$(CMD)"

.PHONY: format
format: sync
	$(UV) run ruff format .
	$(UV) run ruff check . --fix

.PHONY: lint
lint: sync
	$(UV) run ruff check .

.PHONY: test
test: sync
	$(UV) run pytest -q

.PHONY: build
build: sync
	$(UV) build

.PHONY: publish-test
publish-test: build
	$(UV) run twine upload --repository testpypi dist/*

.PHONY: publish
publish: build
	$(UV) run twine upload dist/*
