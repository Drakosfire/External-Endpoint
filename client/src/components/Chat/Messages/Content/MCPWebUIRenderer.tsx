import React, { useState, useEffect } from 'react';
import { UIResourceRenderer } from '@mcp-ui/client';
import type { UIResource } from '~/common';

interface MCPWebUIConfig {
    sessionId: string;
    url: string;
    title: string;
    config: {
        width: string;
        height: string;
        sandbox: string;
    };
}

interface MCPWebUIRendererProps {
    resource: UIResource;
    onUIAction?: (result: any) => Promise<void>;
    htmlProps?: any;
}

const MCPWebUIRenderer: React.FC<MCPWebUIRendererProps> = ({
    resource,
    onUIAction,
    htmlProps
}) => {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [config, setConfig] = useState<MCPWebUIConfig | null>(null);

    useEffect(() => {
        if (resource.uri.startsWith('ui://mcp-web-ui/')) {
            try {
                const parsedConfig = JSON.parse(resource.text) as MCPWebUIConfig;
                setConfig(parsedConfig);
            } catch (err) {
                setError('Failed to parse MCP Web UI configuration');
                console.error('Error parsing MCP Web UI config:', err);
            }
        }
    }, [resource]);

    const handleIframeLoad = () => {
        setIsLoading(false);
        setError(null);
    };

    const handleIframeError = () => {
        setIsLoading(false);
        setError('Failed to load MCP Web UI');
    };

    const handleOpenInNewTab = () => {
        if (config?.url) {
            window.open(config.url, '_blank', 'noopener,noreferrer');
        }
    };

    // If it's not a mcp-web-ui resource, use the default renderer
    if (!resource.uri.startsWith('ui://mcp-web-ui/')) {
        return (
            <UIResourceRenderer
                resource={resource}
                onUIAction={onUIAction}
                htmlProps={htmlProps}
            />
        );
    }

    if (error) {
        return (
            <div className="mcp-web-ui-error border border-red-500 bg-red-50 p-4 rounded-lg">
                <div className="flex items-center gap-2 text-red-700">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Error loading MCP Web UI</span>
                </div>
                <p className="text-red-600 text-sm mt-1">{error}</p>
                {config?.url && (
                    <button
                        onClick={handleOpenInNewTab}
                        className="mt-2 text-sm text-red-700 hover:text-red-800 underline"
                    >
                        Open in new tab
                    </button>
                )}
            </div>
        );
    }

    if (!config) {
        return (
            <div className="mcp-web-ui-loading border border-gray-200 bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center gap-2 text-gray-600">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                    <span>Loading MCP Web UI...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="mcp-web-ui-container border border-gray-200 rounded-lg overflow-hidden">
            {/* Header */}
            <div className="mcp-web-ui-header bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 4a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1V8zm8 0a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V8zm0 4a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1v-2z" clipRule="evenodd" />
                    </svg>
                    <h3 className="text-sm font-medium text-gray-900">{config.title}</h3>
                </div>
                <button
                    onClick={handleOpenInNewTab}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                    title="Open in new tab"
                >
                    Open
                </button>
            </div>

            {/* Loading state */}
            {isLoading && (
                <div className="mcp-web-ui-loading-overlay absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10">
                    <div className="flex items-center gap-2 text-gray-600">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                        <span className="text-sm">Loading dashboard...</span>
                    </div>
                </div>
            )}

            {/* Iframe */}
            <div className="relative">
                <iframe
                    src={config.url}
                    width={config.config.width}
                    height={config.config.height}
                    sandbox={config.config.sandbox}
                    title={config.title}
                    onLoad={handleIframeLoad}
                    onError={handleIframeError}
                    className="w-full border-0"
                    style={{
                        minHeight: '400px',
                        maxHeight: '800px'
                    }}
                />
            </div>

            {/* Footer with session info */}
            <div className="mcp-web-ui-footer bg-gray-50 px-4 py-2 border-t border-gray-200 text-xs text-gray-500">
                <div className="flex items-center justify-between">
                    <span>Session: {config.sessionId.slice(0, 8)}...</span>
                    <span>MCP Web UI Framework</span>
                </div>
            </div>
        </div>
    );
};

export default MCPWebUIRenderer;
