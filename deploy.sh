#!/bin/bash

# =============================================================================
# Finvasia Trading Bot - Quick Deploy Script (For Server)
# =============================================================================
# This script should be run on the Oracle Cloud server
# It pulls latest code and restarts the application
# =============================================================================

set -e  # Exit on error

echo "========================================="
echo "Finvasia Trading Bot - Quick Deploy"
echo "========================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if in correct directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: package.json not found. Run this script from the Finvasia directory.${NC}"
    exit 1
fi

# Pull latest code
echo -e "${YELLOW}[1/5] Pulling latest code from git...${NC}"
git pull

# Check if build directory exists
if [ ! -d "build" ]; then
    echo -e "${YELLOW}[2/5] Build directory not found. Creating swap and building...${NC}"
    
    # Check if swap exists
    if ! swapon --show | grep -q '/swapfile'; then
        echo -e "${YELLOW}Creating 4GB swap file (this may take a few minutes)...${NC}"
        sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
        sudo chmod 600 /swapfile
        sudo mkswap /swapfile
        sudo swapon /swapfile
        echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
        echo -e "${GREEN}✓ Swap created${NC}"
    fi
    
    echo -e "${YELLOW}Building application...${NC}"
    npm run build:prod
    echo -e "${GREEN}✓ Build complete${NC}"
else
    echo -e "${GREEN}✓ Build directory exists${NC}"
fi

# Create logs directory if it doesn't exist
echo -e "${YELLOW}[3/5] Checking logs directory...${NC}"
mkdir -p logs
echo -e "${GREEN}✓ Logs directory ready${NC}"

# Install production dependencies (skip if already installed)
echo -e "${YELLOW}[4/5] Checking dependencies...${NC}"
if [ ! -d "node_modules" ]; then
    echo "Installing production dependencies..."
    npm install --production
    echo -e "${GREEN}✓ Dependencies installed${NC}"
else
    echo -e "${GREEN}✓ Dependencies already installed${NC}"
fi

# Restart PM2 application
echo -e "${YELLOW}[5/5] Restarting application with PM2...${NC}"

# Check if PM2 process exists
if pm2 describe finvasia-trading > /dev/null 2>&1; then
    echo "Stopping existing process..."
    pm2 stop finvasia-trading
    pm2 delete finvasia-trading
fi

# Start fresh
pm2 start ecosystem.config.js
pm2 save

echo -e "${GREEN}✓ Application restarted${NC}"
echo ""

# Show status
echo "========================================="
echo "Deployment Complete!"
echo "========================================="
echo ""
pm2 status
echo ""
echo "View logs:"
echo "  pm2 logs finvasia-trading"
echo ""
echo "Monitor app:"
echo "  pm2 monit"
echo ""
echo "Check memory:"
echo "  free -h"
echo ""
