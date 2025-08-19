#!/bin/bash

# LibreChat Local Build Script
# This script builds LibreChat from your local fork

set -e

echo "🏗️ Building LibreChat from local fork..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "Dockerfile" ]; then
    echo "❌ Error: Dockerfile not found. Please run this script from the LibreChat directory."
    exit 1
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️ Warning: .env file not found. Creating from template..."
    if [ -f "env.secure.example" ]; then
        cp env.secure.example .env
        echo "✅ Created .env from template. Please edit it with your secure values."
    else
        echo "❌ Error: No .env template found. Please create .env manually."
        exit 1
    fi
fi

# Build options
BUILD_TYPE=${1:-"dev"}
COMPOSE_FILE="docker-compose.yml"

if [ "$BUILD_TYPE" = "prod" ]; then
    COMPOSE_FILE="deploy-compose.yml"
    echo -e "${BLUE}Building for production deployment...${NC}"
else
    echo -e "${BLUE}Building for development...${NC}"
fi

# Clean up any existing containers
echo -e "${YELLOW}Stopping existing containers...${NC}"
docker-compose -f $COMPOSE_FILE down

# Build the images
echo -e "${YELLOW}Building LibreChat images...${NC}"
docker-compose -f $COMPOSE_FILE build --no-cache

# Start the services
echo -e "${YELLOW}Starting services...${NC}"
docker-compose -f $COMPOSE_FILE up -d

# Wait for services to be ready
echo -e "${YELLOW}Waiting for services to start...${NC}"
sleep 30

# Verify the build
echo -e "${YELLOW}Verifying build...${NC}"

# Check if containers are running
if docker-compose -f $COMPOSE_FILE ps | grep -q "Up"; then
    echo -e "${GREEN}✅ All containers are running${NC}"
else
    echo -e "❌ Some containers failed to start"
    docker-compose -f $COMPOSE_FILE logs
    exit 1
fi

# Check MongoDB connection
if docker exec chat-mongodb mongosh --eval "db.runCommand('ping')" >/dev/null 2>&1; then
    echo -e "${GREEN}✅ MongoDB is running and accessible${NC}"
else
    echo -e "⚠️ MongoDB connection check failed (may still be starting)"
fi

# Check LibreChat health
if curl -s --connect-timeout 10 http://localhost:3080/health >/dev/null 2>&1; then
    echo -e "${GREEN}✅ LibreChat is responding${NC}"
else
    echo -e "⚠️ LibreChat health check failed (may still be starting)"
fi

echo ""
echo -e "${GREEN}🎉 Build completed successfully!${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Test the application: http://localhost:3080"
echo "2. View logs: docker-compose -f $COMPOSE_FILE logs -f"
echo "3. Stop services: docker-compose -f $COMPOSE_FILE down"
echo ""
echo -e "${BLUE}Build info:${NC}"
echo "- Build type: $BUILD_TYPE"
echo "- Compose file: $COMPOSE_FILE"
echo "- Local fork: $(git rev-parse --short HEAD)"
echo "- Branch: $(git branch --show-current)"
