#!/usr/bin/env bash
# ==============================================================================
# AnalogAir - Automated Update Script
# Updates AnalogAir to the latest GitHub version with safe service management
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
echo -e "${CYAN} AnalogAir - Updating to Latest Version${NC}"
echo -e "${CYAN}========================================================${NC}"

# 1. Stop active AnalogAir user services to avoid file locks and pipe collisions
echo ""
echo -e "${YELLOW}[1/4] Stopping background services...${NC}"
systemctl --user stop analogair-capture.service analogair-daemon.service analogair-web.service 2>/dev/null || true
echo "Services stopped safely."

# 2. Pull latest code from Git if running inside a Git clone
echo ""
echo -e "${YELLOW}[2/4] Fetching latest version from GitHub...${NC}"
if [ -d ".git" ]; then
    git fetch --all 2>/dev/null || true
    git reset --hard origin/main 2>/dev/null || git pull origin main 2>/dev/null || git pull 2>/dev/null || true
    echo "Git repository synchronized to latest commit."
else
    echo "Note: Not inside a .git repository. Running installer with local scripts."
fi

# 3. Run installer to update scripts, virtual environment, and UI assets
echo ""
echo -e "${YELLOW}[3/4] Updating scripts, dependencies, and web assets...${NC}"
chmod +x ./install.sh
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
