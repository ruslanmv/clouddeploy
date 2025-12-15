#!/bin/bash
set -e

# ============================================================
# UNIVERSAL CLOUD CLI INSTALLER WIZARD
# Supports: Linux (x86_64, ARM64), macOS (Intel, Apple Silicon)
# Included: OpenShift (oc), Kubernetes (kubectl), IBM, AWS, Azure, GCP
# ============================================================

# --- Helper Functions ---

detect_platform() {
    OS="$(uname -s)"
    ARCH="$(uname -m)"

    case "${OS}" in
        Linux*)     OS_TYPE="linux";;
        Darwin*)    OS_TYPE="mac";;
        *)          echo "Error: Unsupported OS ${OS}"; exit 1;;
    esac

    case "${ARCH}" in
        x86_64*)    ARCH_TYPE="x86_64";;
        arm64*|aarch64*) ARCH_TYPE="arm64";;
        *)          echo "Error: Unsupported Architecture ${ARCH}"; exit 1;;
    esac

    echo " > Detected: $OS_TYPE ($ARCH_TYPE)"
}

check_dependencies() {
    echo " > Checking system dependencies..."
    if ! command -v curl >/dev/null; then echo "Error: 'curl' is required."; exit 1; fi
    if ! command -v tar >/dev/null; then echo "Error: 'tar' is required."; exit 1; fi
    if ! command -v unzip >/dev/null; then echo "Warning: 'unzip' is not found (required for AWS)."; fi
}

# --- Installers ---

install_openshift_kubectl() {
    echo ""
    echo "--- Installing OpenShift (oc) & Kubernetes (kubectl) ---"

    # Map vars for OpenShift specific naming conventions
    local OC_OS=$OS_TYPE
    local OC_ARCH=""

    # OpenShift naming: mac=mac, linux=linux. Arch: x86 is empty, arm is -arm64
    if [ "$ARCH_TYPE" == "arm64" ]; then OC_ARCH="-arm64"; fi

    FILE_NAME="openshift-client-${OC_OS}${OC_ARCH}.tar.gz"
    DOWNLOAD_URL="https://mirror.openshift.com/pub/openshift-v4/clients/ocp/stable/${FILE_NAME}"

    TMP_DIR=$(mktemp -d)
    echo " > Downloading from $DOWNLOAD_URL..."
    curl -L -o "$TMP_DIR/$FILE_NAME" "$DOWNLOAD_URL"

    echo " > Extracting..."
    tar -zxf "$TMP_DIR/$FILE_NAME" -C "$TMP_DIR"

    echo " > Installing to /usr/local/bin (Sudo password may be needed)..."
    sudo mv "$TMP_DIR/oc" "$TMP_DIR/kubectl" /usr/local/bin/

    rm -rf "$TMP_DIR"

    echo " > Verifying..."
    oc version --client
    echo "✔ OpenShift & Kubernetes Tools Installed."
}

install_ibm_cloud() {
    echo ""
    echo "--- Installing IBM Cloud CLI ---"
    # IBM provides a universal installer script
    curl -fsSL https://clis.cloud.ibm.com/install/linux | sh
    echo "✔ IBM Cloud CLI Installed."
}

install_aws_cli() {
    echo ""
    echo "--- Installing AWS CLI v2 ---"
    TMP_DIR=$(mktemp -d)
    cd "$TMP_DIR"

    if [ "$OS_TYPE" == "mac" ]; then
        curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
        echo " > Running macOS Installer (Sudo required)..."
        sudo installer -pkg AWSCLIV2.pkg -target /
    elif [ "$OS_TYPE" == "linux" ]; then
        if [ "$ARCH_TYPE" == "arm64" ]; then
            curl "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "awscliv2.zip"
        else
            curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
        fi
        unzip -q awscliv2.zip
        sudo ./aws/install --update
    fi

    cd ~
    rm -rf "$TMP_DIR"
    aws --version
    echo "✔ AWS CLI Installed."
}

install_azure_cli() {
    echo ""
    echo "--- Installing Azure CLI (az) ---"
    if [ "$OS_TYPE" == "mac" ]; then
        if command -v brew >/dev/null; then
            brew update && brew install azure-cli
        else
            echo "Error: Homebrew is required for easy Azure install on Mac. Visit https://brew.sh"
        fi
    else
        # Generic Linux install (curl to bash)
        curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
    fi
    echo "✔ Azure CLI Installed."
}

install_gcp_cli() {
    echo ""
    echo "--- Installing Google Cloud SDK (gcloud) ---"
    # This is a basic install; usually requires interactive shell for path updates
    echo " > Downloading generic install script..."
    curl https://sdk.cloud.google.com | bash
    echo "⚠ Note: You may need to restart your terminal or source your profile to use 'gcloud'."
}

# --- Main Wizard Loop ---

clear
echo "========================================================"
echo "   CLOUD DEPLOYMENT CLI SETUP WIZARD"
echo "========================================================"
detect_platform
check_dependencies

while true; do
    echo ""
    echo "Select the environment you want to prepare:"
    echo "1) OpenShift (oc) & Kubernetes (kubectl) [Base Requirement]"
    echo "2) IBM Cloud (ibmcloud)"
    echo "3) AWS (aws)"
    echo "4) Azure (az)"
    echo "5) Google Cloud (gcloud)"
    echo "6) Install ALL OF THE ABOVE"
    echo "0) Exit"
    read -p "Enter choice [0-6]: " choice

    case $choice in
        1) install_openshift_kubectl ;;
        2) install_ibm_cloud ;;
        3) install_aws_cli ;;
        4) install_azure_cli ;;
        5) install_gcp_cli ;;
        6)
           install_openshift_kubectl
           install_ibm_cloud
           install_aws_cli
           install_azure_cli
           install_gcp_cli
           ;;
        0) echo "Exiting. Happy Deploying!"; exit 0 ;;
        *) echo "Invalid option." ;;
    esac

    echo ""
    read -p "Press Enter to return to menu..."
done
