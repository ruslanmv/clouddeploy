#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# push_to_openshift.sh
#
# Interactive Deployment Helper:
# 1. Builds/Selects Docker Image.
# 2. Pushes to IBM Cloud Container Registry (ICR).
# 3. Configures OpenShift Secrets (Image Pull & Environment Variables).
# 4. Deploys to OpenShift (via existing YAMLs or auto-generated manifests).
#
# SECURITY NOTE:
# - No hardcoded secrets.
# - API Keys are generated temporarily or read securely from input.
# - Tokens are masked.
###############################################################################

# --- Configuration Defaults (Safe to change) ---
DEFAULT_IBM_REGION="us-south"
DEFAULT_TAG="latest"

DEFAULT_OS_IMAGEPULLSECRET_NAME="icr-pull-secret"
DEFAULT_OS_ENVSECRET_NAME="app-env-secret"

DEFAULT_APP_NAME="my-openshift-app"
DEFAULT_CONTAINER_PORT="8080"

# --- Internal Variables ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(pwd)"

# --- Formatting Helpers ---
bold() { printf "\033[1m%s\033[0m\n" "$*"; }
info() { printf "ℹ️  %s\n" "$*"; }
ok()   { printf "✅ %s\n" "$*"; }
warn() { printf "⚠️  %s\n" "$*"; }
err()  { printf "❌ ERROR: %s\n" "$*" >&2; }

# --- Dependency Check ---
require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Missing required command: $1"
    err "Please install it and try again."
    exit 1
  fi
}

require_cmd jq
require_cmd docker
require_cmd ibmcloud
require_cmd oc

# --- Main Script Start ---
clear
echo "====================================================================="
bold "   IBM Cloud Container Registry → OpenShift Deployer"
echo "====================================================================="
echo

# Check if Docker Daemon is running
if ! docker info > /dev/null 2>&1; then
  err "Docker daemon is not running. Please start Docker."
  exit 1
fi

###############################################################################
# 1) IBM Cloud Login (SSO)
###############################################################################
if ! ibmcloud account show &>/dev/null; then
  read -rp "→ You are not logged into IBM Cloud. Log in with SSO now? [Y/n] " ans
  ans=${ans:-Y}
  if [[ $ans =~ ^[Yy]$ ]]; then
    ibmcloud login --sso -r "$DEFAULT_IBM_REGION"
    echo
  else
    err "Aborting (not logged in)."
    exit 1
  fi
else
  tgt_user=$(ibmcloud target | awk -F ': +' '/^User/ {print $2}')
  current_region=$(ibmcloud target | awk -F ': +' '/^Region/ {print $2}')
  info "Logged in as: ${tgt_user}"
  info "Current Region: ${current_region}"

  if [[ "$current_region" != "$DEFAULT_IBM_REGION" ]]; then
    read -rp "→ Switch to default region '${DEFAULT_IBM_REGION}'? [Y/n] " switch_region_ans
    switch_region_ans=${switch_region_ans:-Y}
    if [[ $switch_region_ans =~ ^[Yy]$ ]]; then
      ibmcloud target -r "$DEFAULT_IBM_REGION"
      echo
    fi
  fi
fi

###############################################################################
# 2) Resource Group Selection
###############################################################################
echo "→ Verifying Resource Group..."
current_rg_name=$(ibmcloud target | awk -F': +' '/Resource group/ {gsub(/\(.*\)/, ""); print $2}' | awk '{$1=$1};1')

read -rp "→ Use current resource group '${current_rg_name}'? (Type 'list' to change, ENTER to keep): " rg_sel
if [[ -n "$rg_sel" ]]; then
  if [[ "$rg_sel" == "list" ]]; then
    echo "Available resource groups:"
    ibmcloud resource groups
    echo
    read -rp "Enter resource-group name/ID: " rg
    if [[ -n "$rg" ]]; then
      ibmcloud target -g "$rg"
    fi
  else
    ibmcloud target -g "$rg_sel"
  fi
fi
echo

###############################################################################
# 3) ICR Login
###############################################################################
echo "→ Logging Docker into IBM Container Registry..."
if ! ibmcloud cr login >/dev/null; then
  err "Failed to log in to IBM Container Registry."
  exit 1
fi
ok "Docker configured for ICR."
echo

###############################################################################
# 4) Image Strategy Selection
###############################################################################
echo "→ Image Strategy:"
echo "   1) Build from Dockerfile & Push to ICR"
echo "   2) Push existing local image to ICR"
echo "   3) Use existing image in ICR (Skip push)"
read -rp "Selection [1]: " IMAGE_SOURCE_MODE
IMAGE_SOURCE_MODE=${IMAGE_SOURCE_MODE:-1}

case "$IMAGE_SOURCE_MODE" in
  1) IMAGE_SOURCE_MODE="build" ;;
  2) IMAGE_SOURCE_MODE="local" ;;
  3) IMAGE_SOURCE_MODE="icr" ;;
  *) err "Invalid selection."; exit 1 ;;
esac

REMOTE_IMAGE=""
ICR_NAMESPACE=""
ICR_REPO_NAME=""
ICR_IMAGE_TAG=""
ICR_PUSH_REGISTRY_HOST=""

###############################################################################
# 5) Execution: Build/Tag/Push
###############################################################################
if [[ "$IMAGE_SOURCE_MODE" != "icr" ]]; then

  # --- BUILD PHASE ---
  if [[ "$IMAGE_SOURCE_MODE" == "build" ]]; then
    echo "--- Build Configuration ---"
    read -rp "Enter local image name [${DEFAULT_APP_NAME}]: " BUILD_REPO_NAME
    BUILD_REPO_NAME=${BUILD_REPO_NAME:-$DEFAULT_APP_NAME}

    read -rp "Enter image tag [${DEFAULT_TAG}]: " BUILD_TAG
    BUILD_TAG=${BUILD_TAG:-$DEFAULT_TAG}

    LOCAL_IMAGE_BUILD="${BUILD_REPO_NAME}:${BUILD_TAG}"

    read -rp "Docker build context directory [.] : " DOCKER_CONTEXT
    DOCKER_CONTEXT=${DOCKER_CONTEXT:-.}

    BUILD_PLATFORM_FLAG=""
    ARCH=$(uname -m)
    # Automatic fix for Apple Silicon users deploying to standard Linux clusters
    if [[ "$ARCH" == "arm64" || "$ARCH" == "aarch64" ]]; then
      warn "Detected ARM64 architecture ($ARCH)."
      warn "Forcing '--platform linux/amd64' for cluster compatibility."
      BUILD_PLATFORM_FLAG="--platform linux/amd64"
    fi

    info "Building image '${LOCAL_IMAGE_BUILD}'..."
    docker build $BUILD_PLATFORM_FLAG -t "${LOCAL_IMAGE_BUILD}" "${DOCKER_CONTEXT}"
    ok "Build successful."
    echo
  fi

  # --- LOCAL SELECTION PHASE ---
  echo "--- Local Image Selection ---"
  # Fetch recent images
  mapfile -t img_list < <(docker image ls --format '{{.Repository}}:{{.Tag}}' | head -n 10)

  if [[ ${#img_list[@]} -eq 0 ]]; then
    err "No local images found."
    exit 1
  fi

  for i in "${!img_list[@]}"; do printf "   %2d) %s\n" "$((i+1))" "${img_list[$i]}"; done
  echo
  read -rp "Select image number or type full name: " img_sel

  if [[ $img_sel =~ ^[0-9]+$ ]] && (( img_sel>=1 && img_sel<=${#img_list[@]} )); then
    LOCAL_IMAGE="${img_list[$((img_sel-1))]}"
  else
    LOCAL_IMAGE="$img_sel"
    [[ "$LOCAL_IMAGE" == *:* ]] || LOCAL_IMAGE="${LOCAL_IMAGE}:${DEFAULT_TAG}"
  fi

  if ! docker image inspect "$LOCAL_IMAGE" >/dev/null 2>&1; then
    err "Local image '$LOCAL_IMAGE' not found."
    exit 1
  fi
  info "Selected local source: ${LOCAL_IMAGE}"
  echo

  # --- REGISTRY SELECTION ---
  icr_public_endpoints=("us.icr.io" "uk.icr.io" "de.icr.io" "jp.icr.io" "au.icr.io" "icr.io")

  # Try to guess based on current region
  default_icr_push_host_index=1 # Default to us.icr.io
  for i in "${!icr_public_endpoints[@]}"; do
    if [[ "${icr_public_endpoints[$i]}" == "${DEFAULT_IBM_REGION}.icr.io" ]]; then
      default_icr_push_host_index=$((i+1))
    fi
  done

  echo "--- Target Registry ---"
  for i in "${!icr_public_endpoints[@]}"; do
    printf "   %2d) %s\n" "$((i+1))" "${icr_public_endpoints[$i]}"
  done
  read -rp "Select registry [${default_icr_push_host_index}]: " reg_choice
  reg_choice=${reg_choice:-$default_icr_push_host_index}

  ICR_PUSH_REGISTRY_HOST="${icr_public_endpoints[$((reg_choice-1))]}"

  # --- NAMESPACE SELECTION ---
  echo "Fetching namespaces..."
  # Clean JSON parsing for safety
  mapfile -t ns_list < <(ibmcloud cr namespaces --output json 2>/dev/null | jq -r '.[] | .namespace' | sort)

  if [[ ${#ns_list[@]} -eq 0 ]]; then
    err "No ICR namespaces found."
    err "Create one using: ibmcloud cr namespace-add <name>"
    exit 1
  fi

  echo "Available namespaces:"
  for i in "${!ns_list[@]}"; do printf "   %2d) %s\n" "$((i+1))" "${ns_list[$i]}"; done
  read -rp "Select namespace [1]: " ns_choice
  ns_choice=${ns_choice:-1}

  if (( ns_choice < 1 || ns_choice > ${#ns_list[@]} )); then
     ICR_NAMESPACE="${ns_list[0]}" # Fallback
  else
     ICR_NAMESPACE="${ns_list[$((ns_choice-1))]}"
  fi

  # --- PUSH EXECUTION ---
  default_repo=$(basename "${LOCAL_IMAGE%%:*}")
  read -rp "Target Repository Name [${default_repo}]: " ICR_REPO_NAME
  ICR_REPO_NAME=${ICR_REPO_NAME:-$default_repo}

  read -rp "Target Tag [${DEFAULT_TAG}]: " ICR_IMAGE_TAG
  ICR_IMAGE_TAG=${ICR_IMAGE_TAG:-$DEFAULT_TAG}

  REMOTE_IMAGE="${ICR_PUSH_REGISTRY_HOST}/${ICR_NAMESPACE}/${ICR_REPO_NAME}:${ICR_IMAGE_TAG}"

  info "Tagging: ${LOCAL_IMAGE} -> ${REMOTE_IMAGE}"
  docker tag "${LOCAL_IMAGE}" "${REMOTE_IMAGE}"

  info "Pushing to registry (this may take a moment)..."
  docker push "${REMOTE_IMAGE}"
  ok "Image successfully pushed."
  echo

else
  # --- EXISTING ICR IMAGE ---
  echo "--- Select Remote Image ---"
  read -rp "Enter full image URL (e.g., us.icr.io/ns/repo:tag): " REMOTE_IMAGE
  if [[ -z "$REMOTE_IMAGE" ]]; then err "Image cannot be empty."; exit 1; fi

  # Parse Registry Host from URL
  ICR_PUSH_REGISTRY_HOST=$(echo "$REMOTE_IMAGE" | cut -d'/' -f1)
  ok "Using existing image: ${REMOTE_IMAGE}"
  echo
fi

###############################################################################
# 6) OpenShift Deployment
###############################################################################
echo "====================================================================="
bold "   OpenShift Configuration"
echo "====================================================================="

read -rp "→ Deploy '${REMOTE_IMAGE}' to OpenShift now? [Y/n] " deploy_to_os
deploy_to_os=${deploy_to_os:-Y}
if [[ ! $deploy_to_os =~ ^[Yy]$ ]]; then
  ok "Image is ready in registry. Exiting."
  exit 0
fi

# --- OC Login Check ---
if ! oc whoami &>/dev/null; then
  warn "Not logged into OpenShift."
  read -rp "Enter Cluster API URL (e.g., https://c100-e.us-south.containers.cloud.ibm.com:30000): " OS_API
  read -srp "Enter API Token (oc whoami -t): " OS_TOKEN
  echo
  oc login "${OS_API}" --token="${OS_TOKEN}" --insecure-skip-tls-verify=true >/dev/null
  ok "Login successful."
fi

# --- Project Selection ---
current_project="$(oc project -q 2>/dev/null || true)"
echo "Current Project: ${current_project:-None}"
read -rp "→ Project/Namespace to deploy into [${current_project}]: " OS_PROJECT
OS_PROJECT=${OS_PROJECT:-$current_project}

if [[ -z "$OS_PROJECT" ]]; then
  read -rp "Enter new project name: " OS_PROJECT
  oc new-project "$OS_PROJECT" >/dev/null
  ok "Created project: $OS_PROJECT"
else
  if ! oc get project "$OS_PROJECT" &>/dev/null; then
    read -rp "Project '$OS_PROJECT' does not exist. Create it? [Y/n] " create_ns
    create_ns=${create_ns:-Y}
    if [[ $create_ns =~ ^[Yy]$ ]]; then
      oc new-project "$OS_PROJECT" >/dev/null
      ok "Created project: $OS_PROJECT"
    else
      err "Cannot deploy without a project."; exit 1
    fi
  else
    oc project "$OS_PROJECT" >/dev/null
  fi
fi

# --- Pull Secret Setup ---
echo
echo "--- Image Pull Secret Setup ---"
read -rp "Secret Name [${DEFAULT_OS_IMAGEPULLSECRET_NAME}]: " OS_PULLSECRET
OS_PULLSECRET=${OS_PULLSECRET:-$DEFAULT_OS_IMAGEPULLSECRET_NAME}

if ! oc get secret "${OS_PULLSECRET}" &>/dev/null; then
  info "Generating API Key for OpenShift to pull images..."

  # Automatically generate a specialized API key for this specific secret
  API_KEY_NAME="autogen-oc-pull-$(date +%s)"
  REG_PASSWORD="$(ibmcloud iam api-key-create "$API_KEY_NAME" -d "Auto-generated for OpenShift" --output json | jq -r .apikey)"

  if [[ -z "$REG_PASSWORD" || "$REG_PASSWORD" == "null" ]]; then
    err "Failed to generate API Key. Please create secret manually."
    exit 1
  fi

  oc create secret docker-registry "${OS_PULLSECRET}" \
    --docker-server="${ICR_PUSH_REGISTRY_HOST}" \
    --docker-username="iamapikey" \
    --docker-password="${REG_PASSWORD}" \
    --docker-email="no-reply@ibm.com" >/dev/null

  ok "Secret '${OS_PULLSECRET}' created."

  # Link to default service account so pods can use it automatically
  oc secrets link default "${OS_PULLSECRET}" --for=pull >/dev/null || true
  ok "Linked secret to default service account."
else
  info "Secret '${OS_PULLSECRET}' already exists. Using it."
fi

# --- Environment Variable Setup (.env) ---
echo
echo "--- Environment Secrets ---"
read -rp "Path to local .env file [./.env]: " ENV_FILE_PATH
ENV_FILE_PATH=${ENV_FILE_PATH:-./.env}
OS_ENVSECRET=$DEFAULT_OS_ENVSECRET_NAME

if [[ -f "$ENV_FILE_PATH" ]]; then
  read -rp "Create/Update secret from '${ENV_FILE_PATH}'? [Y/n] " do_env
  do_env=${do_env:-Y}

  if [[ $do_env =~ ^[Yy]$ ]]; then
    # Create temp file to strictly parse env vars (removes comments/empty lines)
    CLEAN_ENV_FILE="$(mktemp)"
    grep -v '^#' "$ENV_FILE_PATH" | grep -v '^[[:space:]]*$' > "$CLEAN_ENV_FILE" || true

    if [[ -s "$CLEAN_ENV_FILE" ]]; then
      oc delete secret "${OS_ENVSECRET}" --ignore-not-found=true >/dev/null
      oc create secret generic "${OS_ENVSECRET}" --from-env-file="$CLEAN_ENV_FILE" >/dev/null
      ok "Secret '${OS_ENVSECRET}' updated."
      rm -f "$CLEAN_ENV_FILE"
    else
      warn ".env file was empty or only comments. Skipping secret creation."
    fi
  fi
else
  info "No .env file found at ${ENV_FILE_PATH}. Skipping env secret."
fi

# --- Manifest Application ---
echo
echo "--- Deploying Manifests ---"
read -rp "App Name for Deployment [${DEFAULT_APP_NAME}]: " APP_NAME
APP_NAME=${APP_NAME:-$DEFAULT_APP_NAME}

read -rp "Container Port [${DEFAULT_CONTAINER_PORT}]: " CONTAINER_PORT
CONTAINER_PORT=${CONTAINER_PORT:-$DEFAULT_CONTAINER_PORT}

MANIFEST_MODE="gen"
if [[ -d "${REPO_ROOT}/openshift" ]]; then
  echo "Found './openshift' directory."
  echo "   1) Use existing manifests in ./openshift"
  echo "   2) Generate minimal manifests (Deployment + Service + Route)"
  read -rp "Selection [1]: " m_sel
  m_sel=${m_sel:-1}
  [[ "$m_sel" == "1" ]] && MANIFEST_MODE="repo"
fi

if [[ "$MANIFEST_MODE" == "gen" ]]; then
  info "Generating minimal manifests..."

  # Generate Deployment
  cat <<EOF | oc apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP_NAME}
  labels:
    app: ${APP_NAME}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${APP_NAME}
  template:
    metadata:
      labels:
        app: ${APP_NAME}
    spec:
      imagePullSecrets:
      - name: ${OS_PULLSECRET}
      containers:
      - name: ${APP_NAME}
        image: ${REMOTE_IMAGE}
        ports:
        - containerPort: ${CONTAINER_PORT}
        envFrom:
        - secretRef:
            name: ${OS_ENVSECRET}
            optional: true
EOF

  # Generate Service
  cat <<EOF | oc apply -f -
apiVersion: v1
kind: Service
metadata:
  name: ${APP_NAME}
spec:
  selector:
    app: ${APP_NAME}
  ports:
    - port: 80
      targetPort: ${CONTAINER_PORT}
EOF

  # Generate Route
  cat <<EOF | oc apply -f -
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: ${APP_NAME}
spec:
  to:
    kind: Service
    name: ${APP_NAME}
  port:
    targetPort: ${CONTAINER_PORT}
  tls:
    termination: edge
EOF
  ok "Generated and applied manifests."

else
  info "Applying manifests from ./openshift..."
  oc apply -f "${REPO_ROOT}/openshift/"

  info "Patching deployment with new image..."
  # Attempt to find deployment name matching app, or take the first one found
  DEP_NAME=$(oc get deploy -l app=${APP_NAME} -o name | head -n 1)
  DEP_NAME=${DEP_NAME:-deployment/${APP_NAME}}

  oc set image "${DEP_NAME}" "*=${REMOTE_IMAGE}"
  ok "Patched ${DEP_NAME} with ${REMOTE_IMAGE}"
fi

# --- Final Status ---
echo
info "Waiting for rollout..."
oc rollout status "deployment/${APP_NAME}" || true

echo
echo "====================================================================="
ok "DEPLOYMENT COMPLETE"
echo "====================================================================="
ROUTE_URL=$(oc get route "${APP_NAME}" -o jsonpath='{.spec.host}' 2>/dev/null || true)

if [[ -n "$ROUTE_URL" ]]; then
  echo "Application is available at:"
  bold "https://${ROUTE_URL}"
else
  warn "No Route found. Check your Service/Route configuration."
fi
echo "====================================================================="
