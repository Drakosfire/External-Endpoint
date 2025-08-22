#!/bin/sh

# MCP servers are now properly configured with npm dependencies
# No need for container-time installation since symlinks have been resolved
if [ -d "/app/mcp-servers" ]; then
    echo "MCP servers directory found - dependencies already configured"
fi

# Create writable data directories for MCP servers
if [ -d "/app/mcp-data" ]; then
    echo "Creating MCP data directories..."
    mkdir -p /app/mcp-data/twilio-sms
    mkdir -p /app/mcp-data/scheduled-tasks
    mkdir -p /app/mcp-data/movies
    mkdir -p /app/mcp-data/google-calendar
    mkdir -p /app/mcp-data/gmail
    echo "MCP data directories created successfully"
fi

# Start LibreChat
echo "Starting LibreChat..."
cd /app
exec npm run backend
