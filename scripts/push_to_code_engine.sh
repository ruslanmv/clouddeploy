#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# push_to_code_engine.sh — Interactive helper for:
#   - (Optionally) building & pushing a Docker image to IBM Cloud Container Registry
#   - Or selecting an existing image from IBM Cloud Container Registry
#   - Creating/updating a .env-based secret in IBM Cloud Code Engine
#   - Creating/updating a Code Engine application
#
# NOTE (PUBLIC/SAFE VERSION):
# - All hard-coded project IDs / resource group IDs have been removed.
# - Replace placeholders with your own values or keep interactive selection.
###############################################################################

# --- Public defaults (safe placeholders) ---
DEFAULT_CE_PROJECT_ID=""                 # Optional: leave empty to select interactively
DEFAULT_CE_PROJECT_REGION="us-south"     # Safe default region
DEFAULT_CE_ICR_PRIVATE_ENDPOINT="private.${DEFAULT_CE_PROJECT_REGION}.icr.io"

DEFAULT_IBM_REGION="us-south"            # Default region for IBM Cloud login and ICR
DEFAULT_ICR_REGISTRY_HOST="${DEFAULT_IBM_REGION}.icr.io"
DEFAULT_TAG="latest"

echo "=== IBM Cloud Container Registry & Code Engine Deploy Script (interactive) ==="
echo

# Ensure jq exists (used throughout)
if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: 'jq' is required but not installed. Please install jq and re-run." >&2
  exit 1
fi

###############################################################################
# 1. IBM Cloud login (SSO)
###############################################################################
if ! ibmcloud account show &>/dev/null; then
  read -rp "→ You are not logged into IBM Cloud. Log in with SSO now (region: ${DEFAULT_IBM_REGION})? [Y/n] " ans
  ans=${ans:-Y}
  if [[ $ans =~ ^[Yy]$ ]]; then
    ibmcloud login --sso -r "$DEFAULT_IBM_REGION"
    echo
  else
    echo "Aborting (not logged in)." >&2
    exit 1
  fi
else
  tgt_user=$(ibmcloud target | awk -F ': +' '/^User/ {print $2}')
  current_region=$(ibmcloud target | awk -F ': +' '/^Region/ {print $2}')
  echo "Already logged in as ${tgt_user} (Region: ${current_region})"
  if [[ "$current_region" != "$DEFAULT_IBM_REGION" ]]; then
      read -rp "→ Your current region is '$current_region'. Target '${DEFAULT_IBM_REGION}' for ICR operations? [Y/n] " switch_region_ans
      switch_region_ans=${switch_region_ans:-Y}
      if [[ $switch_region_ans =~ ^[Yy]$ ]]; then
          ibmcloud target -r "$DEFAULT_IBM_REGION"
          echo
      fi
  fi
fi

###############################################################################
# 2. (Optional) switch account
###############################################################################
read -rp "→ Need to switch to a different IBM Cloud account? [y/N] " switch_acc
switch_acc=${switch_acc:-N}
if [[ $switch_acc =~ ^[Yy]$ ]]; then
  ibmcloud target --ca
  echo
fi

###############################################################################
# 3. Choose resource group
###############################################################################
echo "→ Targeting resource group for ICR and other operations."
current_rg_name=$(ibmcloud target | awk -F': +' '/Resource group/ {gsub(/\(.*\)/, ""); print $2}' | awk '{$1=$1};1')
current_rg_id=$(ibmcloud target | awk -F': +' '/Resource group/ {match($0, /\(([^)]+)\)/); print substr($0, RSTART+1, RLENGTH-2)}')

echo "Current resource group: ${current_rg_name} (${current_rg_id})"
read -rp "→ Use current resource group, or type 'list' to choose another? (press ENTER to keep current): " rg_sel
if [[ -n "$rg_sel" ]]; then
  if [[ "$rg_sel" == "list" ]]; then
    echo "→ Available resource groups:"
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
# 4. Log in to the Container Registry
###############################################################################
echo "→ Logging Docker in to IBM Container Registry…"
if ! ibmcloud cr login; then
    echo "ERROR: Failed to log in to IBM Container Registry." >&2
    echo "Please check your IBM Cloud login, permissions, and try again." >&2
    exit 1
fi
echo

###############################################################################
# 5. Choose how to obtain the image
###############################################################################
echo "→ Choose how you want to obtain the container image:"
echo "   1) Build from local Dockerfile and push to IBM Cloud Container Registry"
echo "   2) Use existing local Docker image and push to IBM Cloud Container Registry"
echo "   3) Use existing image already in IBM Cloud Container Registry (NO push)"
read -rp "Selection [1]: " IMAGE_SOURCE_MODE
IMAGE_SOURCE_MODE=${IMAGE_SOURCE_MODE:-1}

case "$IMAGE_SOURCE_MODE" in
  1) IMAGE_SOURCE_MODE="build" ;;
  2) IMAGE_SOURCE_MODE="local" ;;
  3) IMAGE_SOURCE_MODE="icr" ;;
  *) echo "Invalid selection. Aborting." >&2; exit 1 ;;
esac

REMOTE_IMAGE_FOR_PUSH=""
ICR_NAMESPACE=""
ICR_REPO_NAME=""
ICR_IMAGE_TAG=""
ICR_PUSH_REGISTRY_HOST=""

###############################################################################
# 6–10. Build/pick local image + push to ICR (for modes 'build' and 'local')
###############################################################################
if [[ "$IMAGE_SOURCE_MODE" != "icr" ]]; then
  if [[ "$IMAGE_SOURCE_MODE" == "build" ]]; then
    echo "→ Building Docker image from Dockerfile..."

    read -rp "Enter local image name [my-app]: " BUILD_REPO_NAME
    BUILD_REPO_NAME=${BUILD_REPO_NAME:-my-app}

    read -rp "Enter image tag [${DEFAULT_TAG}]: " BUILD_TAG
    BUILD_TAG=${BUILD_TAG:-$DEFAULT_TAG}

    LOCAL_IMAGE_BUILD="${BUILD_REPO_NAME}:${BUILD_TAG}"

    read -rp "Docker build context directory [.] : " DOCKER_CONTEXT
    DOCKER_CONTEXT=${DOCKER_CONTEXT:-.}

    # Detect Mac/ARM64 and force AMD64 (common for CE runtime compatibility)
    BUILD_PLATFORM_FLAG=""
    ARCH=$(uname -m)
    if [[ "$ARCH" == "arm64" || "$ARCH" == "aarch64" ]]; then
        echo "⚠️  Detected ARM64 architecture ($ARCH)."
        echo "   Adding '--platform linux/amd64' to improve compatibility with Code Engine."
        BUILD_PLATFORM_FLAG="--platform linux/amd64"
    fi

    echo "Building image '${LOCAL_IMAGE_BUILD}' from context '${DOCKER_CONTEXT}'..."
    docker build $BUILD_PLATFORM_FLAG -t "${LOCAL_IMAGE_BUILD}" "${DOCKER_CONTEXT}"
    echo
  fi

  echo "→ Local Docker images:"
  mapfile -t img_list < <(docker image ls --format '{{.Repository}}:{{.Tag}} ({{.ID}})')
  if [[ ${#img_list[@]} -eq 0 ]]; then
    echo "No local images found." >&2
    exit 1
  fi
  for i in "${!img_list[@]}"; do printf "   %2d) %s\n" "$((i+1))" "${img_list[$i]}"; done
  echo

  read -rp "Pick image NUMBER or type full repo[:tag]: " img_sel
  if [[ $img_sel =~ ^[0-9]+$ ]] && (( img_sel>=1 && img_sel<=${#img_list[@]} )); then
    LOCAL_IMAGE="${img_list[$((img_sel-1))]%% *}"
  else
    LOCAL_IMAGE="$img_sel"
    [[ "$LOCAL_IMAGE" == *:* ]] || LOCAL_IMAGE="${LOCAL_IMAGE}:${DEFAULT_TAG}"
  fi

  if ! docker image inspect "$LOCAL_IMAGE" &> /dev/null; then
      echo "ERROR: Local image '$LOCAL_IMAGE' not found." >&2
      exit 1
  fi

  echo "Selected local image: ${LOCAL_IMAGE}"
  echo

  icr_public_endpoints=("us.icr.io" "uk.icr.io" "de.icr.io" "jp.icr.io" "au.icr.io" "br.icr.io" "ca.icr.io" "icr.io")
  echo "→ IBM Cloud Container Registry public regional endpoints (for Docker push):"
  default_icr_push_host_index=-1
  for i in "${!icr_public_endpoints[@]}"; do
    printf "   %2d) %s\n" "$((i+1))" "${icr_public_endpoints[$i]}"
    if [[ "${icr_public_endpoints[$i]}" == "$DEFAULT_ICR_REGISTRY_HOST" ]]; then
        default_icr_push_host_index=$((i+1))
    fi
  done
  printf "   0) Other / custom (must end in '.icr.io')\n"

  prompt_text="Select registry for push"
  if [[ $default_icr_push_host_index -ne -1 ]]; then
      prompt_text+=" [${default_icr_push_host_index} for ${DEFAULT_ICR_REGISTRY_HOST}]"
  fi
  prompt_text+=": "
  read -rp "$prompt_text" reg_choice
  reg_choice=${reg_choice:-$default_icr_push_host_index}

  if [[ $reg_choice == 0 ]]; then
    read -rp "Enter custom registry (must end in '.icr.io'): " ICR_PUSH_REGISTRY_HOST
    [[ "$ICR_PUSH_REGISTRY_HOST" =~ \.icr\.io$ ]] || { echo "Invalid registry format. Aborting."; exit 1; }
  else
    if (( reg_choice < 1 || reg_choice > ${#icr_public_endpoints[@]} )); then
        echo "Invalid selection. Aborting." >&2; exit 1;
    fi
    ICR_PUSH_REGISTRY_HOST="${icr_public_endpoints[$((reg_choice-1))]}"
  fi

  echo "Using ICR push registry: ${ICR_PUSH_REGISTRY_HOST}"
  echo

  echo "→ Fetching your Container Registry namespaces..."
  mapfile -t ns_list < <(ibmcloud cr namespaces --output json 2>/dev/null | jq -r '.[] | strings // .namespace // empty')
  if [[ ${#ns_list[@]} -eq 0 ]]; then
      mapfile -t ns_list < <(ibmcloud cr namespaces | awk 'NR>2 && NF>0 {print $1}')
  fi

  if [[ ${#ns_list[@]} -eq 0 || ( ${#ns_list[@]} -eq 1 && -z "${ns_list[0]}" )  ]]; then
    echo "No namespaces found in the current ICR region." >&2
    echo "Create one with: ibmcloud cr namespace-add <your-namespace>" >&2
    exit 1
  fi

  echo "Available namespaces:"
  for i in "${!ns_list[@]}"; do printf "   %2d) %s\n" "$((i+1))" "${ns_list[$i]}"; done
  echo "   0) Other / custom"
  read -rp "Select namespace [1]: " ns_choice
  ns_choice=${ns_choice:-1}

  if [[ $ns_choice == 0 ]]; then
    read -rp "Enter custom namespace: " ICR_NAMESPACE
  else
    if (( ns_choice < 1 || ns_choice > ${#ns_list[@]} )); then
        echo "Invalid selection. Aborting." >&2; exit 1;
    fi
    ICR_NAMESPACE="${ns_list[$((ns_choice-1))]}"
  fi

  echo "Using namespace: ${ICR_NAMESPACE}"
  echo

  default_repo=$(basename "${LOCAL_IMAGE%%:*}")
  read -rp "Repository name for ICR [${default_repo}]: " ICR_REPO_NAME
  ICR_REPO_NAME=${ICR_REPO_NAME:-$default_repo}

  read -rp "Image tag for ICR [${DEFAULT_TAG}]: " ICR_IMAGE_TAG
  ICR_IMAGE_TAG=${ICR_IMAGE_TAG:-$DEFAULT_TAG}

  REMOTE_IMAGE_FOR_PUSH="${ICR_PUSH_REGISTRY_HOST}/${ICR_NAMESPACE}/${ICR_REPO_NAME}:${ICR_IMAGE_TAG}"

  echo
  echo "Remote image for push will be →  ${REMOTE_IMAGE_FOR_PUSH}"
  read -rp "Proceed with tagging and pushing to ICR? [Y/n] " go_push
  go_push=${go_push:-Y}
  [[ $go_push =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
  echo

  echo "Tagging ${LOCAL_IMAGE} → ${REMOTE_IMAGE_FOR_PUSH}"
  docker tag "${LOCAL_IMAGE}" "${REMOTE_IMAGE_FOR_PUSH}"

  echo "Pushing to ${REMOTE_IMAGE_FOR_PUSH}…"
  docker push "${REMOTE_IMAGE_FOR_PUSH}"
  echo

  echo "→ Verifying image in IBM Cloud Container Registry..."
  if ibmcloud cr image-inspect "${REMOTE_IMAGE_FOR_PUSH}" &> /dev/null; then
    echo "✅ Successfully pushed and verified image in ICR: ${REMOTE_IMAGE_FOR_PUSH}"
  else
    echo "⚠️  Could not automatically verify image in ICR. Please check manually."
    echo "Listing images in namespace '${ICR_NAMESPACE}':"
    ibmcloud cr images --restrict "${ICR_NAMESPACE}"
  fi
  echo

else
  echo "→ Using existing image from IBM Cloud Container Registry (no push)."
  echo "Listing images in current region..."

  mapfile -t icr_images < <(
    ibmcloud cr image-list --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
    | grep -E '.+:.+' || true
  )

  if [[ ${#icr_images[@]} -eq 0 ]]; then
    echo "No images returned by 'ibmcloud cr image-list'."
    echo "You can push an image first, or specify the full image path manually."
    read -rp "Enter full ICR image (e.g., us.icr.io/namespace/repo:tag): " REMOTE_IMAGE_FOR_PUSH
  else
    for i in "${!icr_images[@]}"; do
      printf "   %2d) %s\n" "$((i+1))" "${icr_images[$i]}"
    done
    echo "   0) Enter custom image manually"
    read -rp "Select image [1]: " img_choice
    img_choice=${img_choice:-1}
    if [[ "$img_choice" == "0" ]]; then
      read -rp "Enter full ICR image (e.g., us.icr.io/namespace/repo:tag): " REMOTE_IMAGE_FOR_PUSH
    else
      if (( img_choice < 1 || img_choice > ${#icr_images[@]} )); then
        echo "Invalid selection. Aborting." >&2
        exit 1
      fi
      REMOTE_IMAGE_FOR_PUSH="${icr_images[$((img_choice-1))]}"
    fi
  fi

  IMAGE_NO_TAG="${REMOTE_IMAGE_FOR_PUSH%%:*}"
  ICR_IMAGE_TAG="${REMOTE_IMAGE_FOR_PUSH##*:}"
  IFS='/' read -r ICR_PUSH_REGISTRY_HOST ICR_NAMESPACE ICR_REPO_NAME <<< "${IMAGE_NO_TAG}"
  if [[ -z "${ICR_PUSH_REGISTRY_HOST}" || -z "${ICR_NAMESPACE}" || -z "${ICR_REPO_NAME}" ]]; then
    echo "ERROR: Could not parse registry/namespace/repo from '${REMOTE_IMAGE_FOR_PUSH}'." >&2
    exit 1
  fi

  echo "Selected ICR image: ${REMOTE_IMAGE_FOR_PUSH}"
  echo "  Registry : ${ICR_PUSH_REGISTRY_HOST}"
  echo "  Namespace: ${ICR_NAMESPACE}"
  echo "  Repo     : ${ICR_REPO_NAME}"
  echo "  Tag      : ${ICR_IMAGE_TAG}"
  echo
fi

###############################################################################
#                        CODE ENGINE DEPLOYMENT                               #
###############################################################################
echo "---------------------------------------------------------------------"
echo "=== IBM Cloud Code Engine Deployment ==="
echo "---------------------------------------------------------------------"
read -rp "→ Do you want to deploy this image (${REMOTE_IMAGE_FOR_PUSH}) to Code Engine? [Y/n] " deploy_to_ce
deploy_to_ce=${deploy_to_ce:-Y}

if [[ ! $deploy_to_ce =~ ^[Yy]$ ]]; then
  echo "Skipping Code Engine deployment."
  echo "✅ ICR image ready: ${REMOTE_IMAGE_FOR_PUSH}"
  exit 0
fi

CE_IMAGE_PATH_FOR_PULL="${ICR_PUSH_REGISTRY_HOST}/${ICR_NAMESPACE}/${ICR_REPO_NAME}:${ICR_IMAGE_TAG}"
CE_REGISTRY_SERVER_FOR_SECRET="${ICR_PUSH_REGISTRY_HOST}"

echo "Image will be pulled by Code Engine from: ${CE_IMAGE_PATH_FOR_PULL}"
echo

###############################################################################
# CE-1. Install Code Engine Plugin
###############################################################################
echo "→ Checking for Code Engine plugin..."
if ! ibmcloud plugin show code-engine >/dev/null 2>&1; then
  echo "   ⚠️  Code Engine plugin is NOT installed."
  read -rp "→ Install the 'code-engine' plugin now? [Y/n] " install_ce_plugin
  install_ce_plugin=${install_ce_plugin:-Y}
  if [[ $install_ce_plugin =~ ^[Yy]$ ]]; then
    echo "   Installing 'code-engine' plugin..."
    ibmcloud plugin install code-engine -f
    echo "   ✅ Code Engine plugin installed successfully."
  else
    echo "ERROR: Code Engine plugin is required. Aborting." >&2; exit 1
  fi
else
  echo "   Code Engine plugin found."
fi
echo

###############################################################################
# CE-2. Select Code Engine Project (Global Search)
###############################################################################
echo "→ Searching for Code Engine projects across ALL regions..."

TMP_CE_GLOBAL_LIST=$(mktemp)
if ibmcloud resource service-instances --service-name codeengine --output json > "$TMP_CE_GLOBAL_LIST" 2>/dev/null; then

    mapfile -t global_ce_projects < <(jq -r '.[] | "\(.name)|\(.guid)|\(.region_id)|\(.resource_group_id)|\(.state)"' "$TMP_CE_GLOBAL_LIST")
    rm -f "$TMP_CE_GLOBAL_LIST"

    SELECTED_PROJECT_GUID=""
    SELECTED_PROJECT_REGION=""
    SELECTED_PROJECT_RG_ID=""
    SELECTED_PROJECT_NAME=""

    if [[ ${#global_ce_projects[@]} -eq 0 ]]; then
        echo "⚠️  No Code Engine projects found in this account (any region)."
        read -rp "→ Create a new Code Engine project now? [Y/n] " create_ce_ans
        create_ce_ans=${create_ce_ans:-Y}
        if [[ $create_ce_ans =~ ^[Yy]$ ]]; then
             read -rp "Enter name for NEW project [my-ce-project]: " new_proj_name
             new_proj_name=${new_proj_name:-my-ce-project}
             current_reg=$(ibmcloud target | awk -F ': +' '/^Region/ {print $2}')
             read -rp "Enter region for NEW project [${current_reg}]: " new_proj_region
             new_proj_region=${new_proj_region:-$current_reg}

             echo "Creating project '$new_proj_name' in '$new_proj_region'..."
             ibmcloud ce project create --name "$new_proj_name" --region "$new_proj_region"
             SELECTED_PROJECT_NAME="$new_proj_name"
             SELECTED_PROJECT_REGION="$new_proj_region"
        else
            echo "Aborting."; exit 1
        fi
    else
        echo "Available Code Engine Projects (Global):"
        default_idx=1
        for i in "${!global_ce_projects[@]}"; do
            IFS='|' read -r p_name p_id p_region p_rg p_state <<< "${global_ce_projects[$i]}"
            printf "   %2d) %-20s [Region: %-10s] (Status: %s)\n" "$((i+1))" "$p_name" "$p_region" "$p_state"
            if [[ -n "$DEFAULT_CE_PROJECT_ID" && "$p_id" == "$DEFAULT_CE_PROJECT_ID" ]]; then
                default_idx=$((i+1))
            fi
        done
        echo "   0) Enter custom Project ID manually"
        echo

        read -rp "Select Code Engine project [${default_idx}]: " ce_choice
        ce_choice=${ce_choice:-$default_idx}

        if [[ "$ce_choice" == "0" ]]; then
             read -rp "Enter Code Engine Project ID/Name: " manual_id
             SELECTED_PROJECT_GUID="$manual_id"
        elif [[ "$ce_choice" =~ ^[0-9]+$ ]] && (( ce_choice >= 1 && ce_choice <= ${#global_ce_projects[@]} )); then
             IFS='|' read -r p_name p_id p_region p_rg p_state <<< "${global_ce_projects[$((ce_choice-1))]}"
             SELECTED_PROJECT_GUID="$p_id"
             SELECTED_PROJECT_REGION="$p_region"
             SELECTED_PROJECT_RG_ID="$p_rg"
             SELECTED_PROJECT_NAME="$p_name"
        else
             echo "Invalid selection."; exit 1
        fi

        current_region=$(ibmcloud target | awk -F ': +' '/^Region/ {print $2}')
        if [[ -n "$SELECTED_PROJECT_REGION" && "$SELECTED_PROJECT_REGION" != "$current_region" ]]; then
            echo "⚠️  Selected project '${SELECTED_PROJECT_NAME}' is in '${SELECTED_PROJECT_REGION}', but you are in '${current_region}'."
            read -rp "→ Switch CLI target to region '${SELECTED_PROJECT_REGION}'? [Y/n] " switch_reg
            switch_reg=${switch_reg:-Y}
            if [[ $switch_reg =~ ^[Yy]$ ]]; then
                ibmcloud target -r "$SELECTED_PROJECT_REGION" -g "$SELECTED_PROJECT_RG_ID"
            fi
        fi

        echo "Selecting Code Engine project..."
        if ! ibmcloud ce project select --id "$SELECTED_PROJECT_GUID" 2>/dev/null; then
             ibmcloud ce project select --name "$SELECTED_PROJECT_NAME"
        fi
    fi
else
    echo "Warning: Failed to fetch global service instances."
    read -rp "Enter Code Engine Project Name: " ce_manual_name
    ibmcloud ce project select --name "$ce_manual_name"
fi

current_ce_project_name=$(ibmcloud ce project current -o json | jq -r .name)
echo "✅ Current Code Engine project: ${current_ce_project_name}"
echo

###############################################################################
# CE-3. Create/Update Registry Secret in Code Engine
###############################################################################
echo "→ Configuring Code Engine access to IBM Cloud Container Registry..."
DEFAULT_CE_REGISTRY_SECRET_NAME="icr-secret-${ICR_NAMESPACE}"
read -rp "Enter name for Code Engine registry secret [${DEFAULT_CE_REGISTRY_SECRET_NAME}]: " CE_REGISTRY_SECRET_NAME
CE_REGISTRY_SECRET_NAME=${CE_REGISTRY_SECRET_NAME:-$DEFAULT_CE_REGISTRY_SECRET_NAME}

if ibmcloud ce registry get --name "${CE_REGISTRY_SECRET_NAME}" &>/dev/null; then
    echo "✅ Registry secret '${CE_REGISTRY_SECRET_NAME}' already exists."
    echo "   Using the existing secret."
else
    echo "⚠️  Registry secret '${CE_REGISTRY_SECRET_NAME}' not found."
    echo "   Code Engine needs an API Key to pull images from '${CE_REGISTRY_SERVER_FOR_SECRET}'."
    echo "   Options:"
    echo "   1) Auto-generate a new API Key using my current login (Recommended)"
    echo "   2) Enter an existing API Key manually"
    read -rp "   Select [1]: " key_choice
    key_choice=${key_choice:-1}

    API_KEY_FOR_CE=""
    if [[ "$key_choice" == "1" ]]; then
        echo "   Generating new API Key for Code Engine..."
        NEW_KEY_NAME="ce-deploy-auto-key-$(date +%s)"
        API_KEY_FOR_CE=$(ibmcloud iam api-key-create "$NEW_KEY_NAME" -d "Auto-generated for Code Engine ${CE_REGISTRY_SECRET_NAME}" --output json | jq -r .apikey)
        if [[ -z "$API_KEY_FOR_CE" || "$API_KEY_FOR_CE" == "null" ]]; then
            echo "ERROR: Failed to auto-generate API key. Permissions?" >&2; exit 1
        fi
        echo "   ✅ API Key generated successfully (${NEW_KEY_NAME})."
    else
        read -srp "   Enter your IBM Cloud API Key: " API_KEY_FOR_CE
        echo
    fi

    echo "   Creating registry secret '${CE_REGISTRY_SECRET_NAME}'..."
    ibmcloud ce registry create --name "${CE_REGISTRY_SECRET_NAME}" \
        --server "${CE_REGISTRY_SERVER_FOR_SECRET}" \
        --username "iamapikey" \
        --password "${API_KEY_FOR_CE}"
    echo "✅ Registry secret created."
fi
API_KEY_FOR_CE="" # clear memory
echo

###############################################################################
# CE-4. Create/Update .env-based Secret in Code Engine
###############################################################################
echo "→ Configure environment variables from .env file (Code Engine secret)..."
read -rp "Path to .env file [./.env]: " ENV_FILE_PATH
ENV_FILE_PATH=${ENV_FILE_PATH:-./.env}

if [[ ! -f "$ENV_FILE_PATH" ]]; then
  echo "ERROR: .env file '$ENV_FILE_PATH' not found." >&2
  exit 1
fi

DEFAULT_ENV_SECRET_NAME="app-env-vars"
read -rp "Enter Code Engine secret name for env vars [${DEFAULT_ENV_SECRET_NAME}]: " CE_ENV_SECRET_NAME
CE_ENV_SECRET_NAME=${CE_ENV_SECRET_NAME:-$DEFAULT_ENV_SECRET_NAME}

echo "Cleaning .env file for Code Engine import..."

CLEAN_ENV_FILE=$(mktemp)
cleanup_env() { [[ -f "$CLEAN_ENV_FILE" ]] && rm -f "$CLEAN_ENV_FILE"; }
trap cleanup_env EXIT

awk '
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*$/ { next }
  {
    line = $0
    sub(/^[[:space:]]+/, "", line)
    idx = index(line, "=")
    if (idx > 0) {
      key = substr(line, 1, idx - 1)
      val = substr(line, idx + 1)
      sub(/[[:space:]]+$/, "", key)
      sub(/[[:space:]]+$/, "", val)
      if (key ~ /^[A-Za-z_][A-Za-z0-9_]*$/ && length(val) > 0) {
         if (!(key in seen)) { order[++n] = key; seen[key] = 1 }
         data[key] = val
      }
    }
  }
  END {
    for (i = 1; i <= n; i++) { k = order[i]; printf "%s=%s\n", k, data[k] }
  }
' "$ENV_FILE_PATH" > "$CLEAN_ENV_FILE"

if [[ ! -s "$CLEAN_ENV_FILE" ]]; then
  echo "ERROR: No valid KEY=VALUE pairs found in ${ENV_FILE_PATH} after cleaning." >&2
  exit 1
fi

echo "Checking if env secret '${CE_ENV_SECRET_NAME}' exists..."
if ibmcloud ce secret get --name "${CE_ENV_SECRET_NAME}" &>/dev/null; then
  echo "Env secret '${CE_ENV_SECRET_NAME}' already exists."
  read -rp "→ Replace it with values from '${ENV_FILE_PATH}'? [Y/n] " replace_env_secret
  replace_env_secret=${replace_env_secret:-Y}
  if [[ $replace_env_secret =~ ^[Yy]$ ]]; then
    echo "Deleting existing secret '${CE_ENV_SECRET_NAME}'..."
    ibmcloud ce secret delete --name "${CE_ENV_SECRET_NAME}" --force || true
  else
    echo "Keeping existing env secret. Skipping update from .env."
  fi
fi

if ! ibmcloud ce secret get --name "${CE_ENV_SECRET_NAME}" &>/dev/null; then
  echo "Creating env secret '${CE_ENV_SECRET_NAME}' from cleaned .env..."
  ibmcloud ce secret create --name "${CE_ENV_SECRET_NAME}" --from-env-file "${CLEAN_ENV_FILE}"
  echo "✅ Env secret '${CE_ENV_SECRET_NAME}' configured in Code Engine."
fi
echo

###############################################################################
# CE-5. Create/Update Code Engine Application
###############################################################################
echo "→ Configuring Code Engine application..."
DEFAULT_CE_APP_NAME="${ICR_REPO_NAME}"
read -rp "Enter Code Engine application name [${DEFAULT_CE_APP_NAME}]: " CE_APP_NAME
CE_APP_NAME=${CE_APP_NAME:-$DEFAULT_CE_APP_NAME}

DEFAULT_CE_APP_PORT="8002"
read -rp "Enter the port your application listens on [${DEFAULT_CE_APP_PORT}]: " CE_APP_PORT
CE_APP_PORT=${CE_APP_PORT:-$DEFAULT_CE_APP_PORT}

DEFAULT_CPU="1"
DEFAULT_MEM="4G"
DEFAULT_MIN_SCALE="0"
DEFAULT_MAX_SCALE="1"

read -rp "CPU [${DEFAULT_CPU}]: " CE_APP_CPU
CE_APP_CPU=${CE_APP_CPU:-$DEFAULT_CPU}

read -rp "Memory [${DEFAULT_MEM}]: " CE_APP_MEM
CE_APP_MEM=${CE_APP_MEM:-$DEFAULT_MEM}

read -rp "Minimum number of instances (e.g., 0 for scale-to-zero) [${DEFAULT_MIN_SCALE}]: " CE_APP_MIN_SCALE
CE_APP_MIN_SCALE=${CE_APP_MIN_SCALE:-$DEFAULT_MIN_SCALE}

read -rp "Maximum number of instances [${DEFAULT_MAX_SCALE}]: " CE_APP_MAX_SCALE
CE_APP_MAX_SCALE=${CE_APP_MAX_SCALE:-$DEFAULT_MAX_SCALE}

echo
echo "---------------------------------------------------------------------"
echo "Code Engine Deployment Summary"
echo "---------------------------------------------------------------------"
echo "  Project name             : ${current_ce_project_name}"
echo "  CE image (pull)          : ${CE_IMAGE_PATH_FOR_PULL}"
echo "  Registry secret          : ${CE_REGISTRY_SECRET_NAME}"
echo "  Env secret (.env)        : ${CE_ENV_SECRET_NAME}"
echo "  Application name         : ${CE_APP_NAME}"
echo "  Port                     : ${CE_APP_PORT}"
echo "  CPU / Memory             : ${CE_APP_CPU} / ${CE_APP_MEM}"
echo "  Scale (Min/Max)          : ${CE_APP_MIN_SCALE} / ${CE_APP_MAX_SCALE}"
echo "  Readiness Probe          : default (managed by Code Engine)"
echo "---------------------------------------------------------------------"
read -rp "Proceed with creating/updating the Code Engine application? [Y/n] " CE_CONFIRM
CE_CONFIRM=${CE_CONFIRM:-Y}
if [[ ! $CE_CONFIRM =~ ^[Yy]$ ]]; then
  echo "Aborting before creating/updating Code Engine app."
  exit 0
fi
echo

echo "Checking if application '${CE_APP_NAME}' exists..."
if ibmcloud ce app get --name "${CE_APP_NAME}" &>/dev/null; then
  echo "Application '${CE_APP_NAME}' already exists. Updating it..."
  ibmcloud ce app update \
    --name "${CE_APP_NAME}" \
    --image "${CE_IMAGE_PATH_FOR_PULL}" \
    --port "${CE_APP_PORT}" \
    --cpu "${CE_APP_CPU}" \
    --memory "${CE_APP_MEM}" \
    --registry-secret "${CE_REGISTRY_SECRET_NAME}" \
    --env-from-secret "${CE_ENV_SECRET_NAME}" \
    --min-scale "${CE_APP_MIN_SCALE}" \
    --max-scale "${CE_APP_MAX_SCALE}"
else
  echo "Creating new application '${CE_APP_NAME}'..."
  ibmcloud ce app create \
    --name "${CE_APP_NAME}" \
    --image "${CE_IMAGE_PATH_FOR_PULL}" \
    --port "${CE_APP_PORT}" \
    --cpu "${CE_APP_CPU}" \
    --memory "${CE_APP_MEM}" \
    --registry-secret "${CE_REGISTRY_SECRET_NAME}" \
    --env-from-secret "${CE_ENV_SECRET_NAME}" \
    --min-scale "${CE_APP_MIN_SCALE}" \
    --max-scale "${CE_APP_MAX_SCALE}"
fi
echo "✅ Code Engine application '${CE_APP_NAME}' configured."
echo

###############################################################################
# CE-6. Show Application URL
###############################################################################
echo "→ Fetching application URL..."
APP_URL=$(ibmcloud ce app get --name "${CE_APP_NAME}" --output json | jq -r '.status.url')
if [[ -n "$APP_URL" && "$APP_URL" != "null" ]]; then
  echo "🚀 Application '${CE_APP_NAME}' should be available at: ${APP_URL}"
else
  echo "Could not retrieve application URL automatically. Please check the IBM Cloud console."
fi
echo
echo "🎉 All done!"
