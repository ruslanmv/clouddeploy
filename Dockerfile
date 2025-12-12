# Use a lightweight Python 3.11 base image
FROM python:3.11-slim-bookworm

# 1. Install System Dependencies
# - curl: to download the IBM Cloud CLI installer
# - jq: required by the push_to_code_engine.sh script for JSON parsing
# - docker.io: docker client (note: running docker builds inside Code Engine requires specific privileges/setup)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    jq \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# 2. Install IBM Cloud CLI
RUN curl -fsSL https://clis.cloud.ibm.com/install/linux | sh

# 3. Install uv (Fast Python Package Manager)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# 4. Set Up Application Directory
WORKDIR /app

# 5. Copy Project Files
COPY pyproject.toml README.md LICENSE ./
COPY clouddeploy/ clouddeploy/
COPY scripts/ scripts/

# 6. Install Python Dependencies
# We install directly into the system environment since this is a container
RUN uv pip install --system .

# 7. Environment Configuration
ENV HOST=0.0.0.0
ENV PORT=8080
# Prevent Python from buffering stdout/stderr
ENV PYTHONUNBUFFERED=1

# Ensure the demo script is executable
RUN chmod +x scripts/*.sh

# 8. Expose the Port
EXPOSE 8080

# 9. Start the CloudDeploy UI
# We use 'sh -c' to ensure environment variables like $PORT are expanded correctly
CMD ["sh", "-c", "clouddeploy ui --host 0.0.0.0 --port $PORT --cmd ./scripts/push_to_code_engine.sh"]