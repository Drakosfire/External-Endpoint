#!/bin/bash

# LibreChat Server Deployment Script
# This script builds LibreChat locally and deploys to your server

set -e

echo "🚀 Deploying LibreChat to server..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
SERVER_USER="alan"
SERVER_HOST="srv586875"
SERVER_PATH="~/projects/LibreChat"
LOCAL_PATH="$(pwd)"

# Check if we're in the right directory
if [ ! -f "Dockerfile" ]; then
    echo -e "${RED}❌ Error: Dockerfile not found. Please run this script from the LibreChat directory.${NC}"
    exit 1
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ Error: .env file not found. Please create it with your secure values.${NC}"
    exit 1
fi

# Build the production image locally
echo -e "${YELLOW}🏗️ Building production image locally...${NC}"
docker-compose -f deploy-compose.yml build --no-cache

# Create a tar file of the built image
echo -e "${YELLOW}📦 Creating image archive...${NC}"
IMAGE_NAME=$(docker-compose -f deploy-compose.yml config --services | head -1)
docker save $IMAGE_NAME > librechat-production.tar

# Upload to server
echo -e "${YELLOW}📤 Uploading to server...${NC}"
scp librechat-production.tar $SERVER_USER@$SERVER_HOST:$SERVER_PATH/
scp deploy-compose.yml $SERVER_USER@$SERVER_HOST:$SERVER_PATH/
scp .env $SERVER_USER@$SERVER_HOST:$SERVER_PATH/
scp -r mongodb/ $SERVER_USER@$SERVER_HOST:$SERVER_PATH/

# Deploy on server
echo -e "${YELLOW}🔧 Deploying on server...${NC}"
ssh $SERVER_USER@$SERVER_HOST << 'EOF'
cd ~/projects/LibreChat

# Stop existing services
echo "Stopping existing services..."
docker-compose -f deploy-compose.yml down

# Load the new image
echo "Loading new image..."
docker load < librechat-production.tar

# Start services
echo "Starting services..."
docker-compose -f deploy-compose.yml up -d

# Wait for services to be ready
echo "Waiting for services to start..."
sleep 30

# Verify deployment
echo "Verifying deployment..."
if docker-compose -f deploy-compose.yml ps | grep -q "Up"; then
    echo "✅ All containers are running"
else
    echo "❌ Some containers failed to start"
    docker-compose -f deploy-compose.yml logs
    exit 1
fi

# Check MongoDB connection
if docker exec chat-mongodb mongosh --eval "db.runCommand('ping')" >/dev/null 2>&1; then
    echo "✅ MongoDB is running and accessible"
else
    echo "⚠️ MongoDB connection check failed"
fi

# Check LibreChat health
if curl -s --connect-timeout 10 http://localhost:3080/health >/dev/null 2>&1; then
    echo "✅ LibreChat is responding"
else
    echo "⚠️ LibreChat health check failed"
fi

# Clean up
rm librechat-production.tar

echo "🎉 Deployment completed successfully!"
echo "Test the application: https://sizzek.dungeonmind.net"
EOF

# Clean up local files
echo -e "${YELLOW}🧹 Cleaning up local files...${NC}"
rm librechat-production.tar

echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo ""
echo -e "${BLUE}Deployment info:${NC}"
echo "- Server: $SERVER_USER@$SERVER_HOST"
echo "- Path: $SERVER_PATH"
echo "- Local commit: $(git rev-parse --short HEAD)"
echo "- Branch: $(git branch --show-current)"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Test the application: https://sizzek.dungeonmind.net"
echo "2. Monitor logs: ssh $SERVER_USER@$SERVER_HOST 'cd $SERVER_PATH && docker-compose -f deploy-compose.yml logs -f'"
echo "3. Run security checks: ssh $SERVER_USER@$SERVER_HOST 'cd $SERVER_PATH && ./nginx/security-monitor.sh'"
