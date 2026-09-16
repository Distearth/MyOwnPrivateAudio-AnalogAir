#!/usr/bin/env bash
# ==============================================================================
# AnalogAir - Automated Clean Update Script
# Updates AnalogAir to the latest GitHub version with safe service management
# Removes old repository folder and pulls a clean clone from GitHub to ensure
# all updated scripts and UI build assets replace existing files.
# ==============================================================================
set -e

# ANSI Color Codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================================${NC}"
echo -e "${CYAN} AnalogAir - Performing Clean Update from GitHub${NC}"
echo -e "${CYAN}========================================================${NC}"

# 1. Stop active AnalogAir user services to avoid file locks and pipe collisions
echo ""
echo -e "${YELLOW}[1/4] Stopping background services...${NC}"
systemctl --user stop analogair-capture.service analogair-daemon.service analogair-web.service 2>/dev/null || true
echo "Services stopped safely."

# 2. Pull down a clean copy of the folder from GitHub
echo ""
echo -e "${YELLOW}[2/4] Removing existing folder and cloning latest version...${NC}"
REPO_DIR="$HOME/MyOwnPrivateAudio-AnalogAir"
TMP_DIR=$(mktemp -d /tmp/analogair-update-XXXXXX)

echo "Cloning latest code from https://github.com/Distearth/MyOwnPrivateAudio-AnalogAir.git..."
git clone https://github.com/Distearth/MyOwnPrivateAudio-AnalogAir.git "$TMP_DIR/MyOwnPrivateAudio-AnalogAir"

# Replace ~/MyOwnPrivateAudio-AnalogAir cleanly
cd "$HOME"
rm -rf "$REPO_DIR"
mv "$TMP_DIR/MyOwnPrivateAudio-AnalogAir" "$REPO_DIR"
rm -rf "$TMP_DIR"
echo "Folder refreshed with latest GitHub changes."

# 3. Run installer to update scripts, virtual environment, and UI assets
echo ""
echo -e "${YELLOW}[3/4] Updating scripts, dependencies, and web assets...${NC}"
cd "$REPO_DIR"
chmod +x ./install.sh ./update.sh
./install.sh

# 4. Reload systemd daemon and restart services
echo ""
echo -e "${YELLOW}[4/4] Reloading systemd and restarting services...${NC}"
systemctl --user daemon-reload
systemctl --user restart analogair-capture.service analogair-daemon.service analogair-web.service

echo ""
echo -e "${GREEN}========================================================${NC}"
echo -e "${GREEN} AnalogAir Update Complete!${NC}"
echo -e "${GREEN}========================================================${NC}"
echo ""
systemctl --user status analogair-web.service --no-pager || true

