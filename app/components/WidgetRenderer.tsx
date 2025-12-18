'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  SandpackProvider,
  SandpackPreview,
  SandpackLayout,
  SandpackConsole,
  useSandpack,
} from '@codesandbox/sandpack-react';
import { Loader2, AlertCircle, RefreshCw, Terminal, ChevronDown, ChevronUp, Wrench, Code, X } from 'lucide-react';

type WidgetData = {
  id: string;
  data: Record<string, unknown>;
};

type SandpackError = {
  message: string;
  line?: number;
  column?: number;
  path?: string;
};

type WidgetRendererProps = {
  widgetId: string;
  componentCode: string;
  dataItems: WidgetData[];
  onDataChange?: (dataItems: WidgetData[]) => void;
  onAskToFix?: (errorMessage: string) => void;
  className?: string;
};

// Strip export statements from the component code to avoid conflicts
function stripExports(code: string): string {
  return code
    .replace(/export\s+default\s+\w+\s*;?\s*$/gm, '') // Remove "export default Widget;"
    .replace(/export\s+default\s+function/g, 'function') // Convert "export default function" to just "function"
    .trim();
}

// Wrapper code that sets up the widget with data and change handling
// Now accepts data updates via postMessage to avoid remounting
function createWrapperCode(componentCode: string, initialData: unknown[]): string {
  const cleanedCode = stripExports(componentCode);
  
  return `
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

// Generated Widget Component
${cleanedCode}

// Initial data passed from parent (used only for first render)
const initialData = ${JSON.stringify(initialData)};

// Wrapper that handles data state and communication
function App() {
  const [data, setData] = React.useState(initialData);

  // Listen for data updates from parent (avoids remounting the widget)
  React.useEffect(() => {
    const handleMessage = (event) => {
      if (event.data?.type === 'WIDGET_DATA_UPDATE') {
        setData(event.data.data);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleDataChange = React.useCallback((newData) => {
    setData(newData);
    // Send message to parent window
    window.parent.postMessage({
      type: 'WIDGET_DATA_CHANGE',
      data: newData
    }, '*');
  }, []);

  return (
    <div style={{ fontFamily: "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif" }} className="min-h-screen bg-zinc-900 p-6 pb-[160px] antialiased text-zinc-100">
      <Widget data={data} onDataChange={handleDataChange} />
    </div>
  );
}

export default App;
`;
}

// Error detector component that uses Sandpack's internal state
function ErrorDetector({ 
  onError, 
  onStatusChange 
}: { 
  onError: (error: SandpackError | null) => void;
  onStatusChange: (status: string) => void;
}) {
  const { sandpack } = useSandpack();
  const prevErrorRef = useRef<string | null>(null);
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Report status changes
    onStatusChange(sandpack.status);
  }, [sandpack.status, onStatusChange]);

  useEffect(() => {
    // Check for bundler errors
    const error = sandpack.error;
    const errorKey = error ? JSON.stringify(error) : null;
    
    // Only update if error changed
    if (errorKey !== prevErrorRef.current) {
      prevErrorRef.current = errorKey;
      
      // Clear any pending timeout
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
        errorTimeoutRef.current = null;
      }
      
      if (error) {
        // Set error immediately
        onError({
          message: error.message || 'An unknown error occurred',
          line: error.line,
          column: error.column,
          path: error.path,
        });
      } else {
        // Debounce clearing error to prevent flickering
        // Only clear if no error persists for 500ms
        errorTimeoutRef.current = setTimeout(() => {
          onError(null);
        }, 500);
      }
    }
    
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
    };
  }, [sandpack.error, onError]);

  return null;
}

// Debug panel component with console output
function DebugPanel({ 
  error,
  showCode,
  onToggleCode,
  componentCode,
}: { 
  error: SandpackError | null;
  showCode: boolean;
  onToggleCode: () => void;
  componentCode: string;
}) {
  return (
    <div className="flex flex-col border-t border-zinc-700 bg-zinc-950">
      {/* Error details section */}
      {error && (
        <div className="border-b border-zinc-800 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-400">Runtime Error</p>
              <p className="text-xs text-zinc-400 mt-1 font-mono break-all">{error.message}</p>
              {(error.line || error.path) && (
                <p className="text-xs text-zinc-500 mt-1">
                  {error.path && <span>File: {error.path}</span>}
                  {error.line && <span className="ml-2">Line: {error.line}</span>}
                  {error.column && <span className="ml-1">Col: {error.column}</span>}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Code viewer toggle */}
      <button
        onClick={onToggleCode}
        className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-300 hover:bg-zinc-900 transition-colors border-b border-zinc-800"
      >
        <Code className="h-3.5 w-3.5" />
        <span>{showCode ? 'Hide' : 'Show'} Generated Code</span>
        {showCode ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
      </button>

      {/* Code viewer */}
      {showCode && (
        <div className="max-h-48 overflow-auto border-b border-zinc-800">
          <pre className="p-3 text-xs font-mono text-zinc-400 whitespace-pre-wrap break-all">
            {componentCode}
          </pre>
        </div>
      )}

      {/* Console output */}
      <div className="flex-1 min-h-[120px] max-h-[200px] overflow-hidden">
        <SandpackConsole 
          showHeader={true}
          showResetConsoleButton={true}
          showSyntaxError={true}
          className="!h-full !bg-zinc-950"
        />
      </div>
    </div>
  );
}


export default function WidgetRenderer({
  widgetId,
  componentCode,
  dataItems,
  onDataChange,
  onAskToFix,
  className = '',
}: WidgetRendererProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<SandpackError | null>(null);
  const [bundlerStatus, setBundlerStatus] = useState<string>('idle');
  const [forceRefreshCount, setForceRefreshCount] = useState(0);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const dataItemsRef = useRef(dataItems);
  const hasInitializedRef = useRef(false);
  const prevComponentCodeRef = useRef(componentCode);

  // Extract just the data values
  const dataArray = useMemo(() => dataItems.map((item) => item.data), [dataItems]);

  // Store the initial data for the first render only
  const initialDataRef = useRef(dataArray);
  
  // Update ref when dataItems change (for message handler)
  useEffect(() => {
    dataItemsRef.current = dataItems;
  }, [dataItems]);

  // When component code changes, update initial data ref so remount uses fresh data
  useEffect(() => {
    if (prevComponentCodeRef.current !== componentCode) {
      initialDataRef.current = dataArray;
      hasInitializedRef.current = false;
      prevComponentCodeRef.current = componentCode;
      // Clear error when code changes
      setError(null);
      setShowDebugPanel(false);
    }
  }, [componentCode, dataArray]);

  // Create a stable key based on widgetId and componentCode (not data)
  // This prevents remounting when only data changes
  const stableKey = useMemo(() => {
    const codeHash = componentCode ? componentCode.length.toString(36) + componentCode.slice(0, 100) : '';
    return `${widgetId}-${codeHash}-${forceRefreshCount}`;
  }, [widgetId, componentCode, forceRefreshCount]);

  // Send data updates to the sandboxed widget via postMessage (avoids remounting)
  useEffect(() => {
    // Skip initial render - the widget already has initialData
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      return;
    }
    
    // Send updated data to the iframe
    const iframe = document.querySelector('.sp-preview-iframe') as HTMLIFrameElement | null;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'WIDGET_DATA_UPDATE',
        data: dataArray,
      }, '*');
    }
  }, [dataArray]);

  // Handle messages from the sandboxed widget
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'WIDGET_DATA_CHANGE' && onDataChange) {
        const newDataArray = event.data.data as Record<string, unknown>[];
        // Map back to WidgetData format, preserving IDs where possible
        const currentDataItems = dataItemsRef.current;
        const updatedDataItems: WidgetData[] = newDataArray.map((data, index) => ({
          id: currentDataItems[index]?.id || `new-${index}`,
          data,
        }));
        onDataChange(updatedDataItems);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onDataChange]);

  // Create the wrapper code with initial data only
  const wrapperCode = useMemo(
    () => createWrapperCode(componentCode, initialDataRef.current),
    [componentCode]
  );

  const handleRefresh = useCallback(() => {
    // Reset initialization so we use fresh data
    hasInitializedRef.current = false;
    initialDataRef.current = dataItemsRef.current.map((item) => item.data);
    setForceRefreshCount((c) => c + 1);
    setError(null);
    setIsLoading(true);
    setShowDebugPanel(false);
  }, []);

  const handleError = useCallback((err: SandpackError | null) => {
    setError(err);
    // Don't auto-show debug panel - keep it user-friendly
  }, []);

  const handleStatusChange = useCallback((status: string) => {
    setBundlerStatus(status);
    // When bundler becomes idle (finished), check if still loading
    if (status === 'idle') {
      // Small delay to ensure preview has time to load
      setTimeout(() => setIsLoading(false), 100);
    }
  }, []);

  const handleAskToFix = useCallback(() => {
    if (error && onAskToFix) {
      const errorContext = `There's an error in the widget code:\n\n${error.message}${error.line ? `\n(Line ${error.line}${error.column ? `, Column ${error.column}` : ''})` : ''}\n\nPlease fix this error.`;
      onAskToFix(errorContext);
    }
  }, [error, onAskToFix]);

  if (!componentCode) {
    return (
      <div className={`flex items-center justify-center p-8 bg-zinc-800 rounded-lg ${className}`}>
        <div className="flex flex-col items-center gap-3 text-zinc-400">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Generating widget...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative flex flex-col overflow-hidden bg-zinc-900 ${className}`}>
      {/* Loading overlay */}
      {isLoading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 z-20">
          <div className="flex flex-col items-center gap-3 text-zinc-400">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">
              {bundlerStatus === 'running' ? 'Bundling...' : 'Loading widget...'}
            </p>
          </div>
        </div>
      )}

      {/* Error overlay - completely solid to hide any flickering underneath */}
      {error && !showDebugPanel && (
        <div className="absolute inset-0 z-50 flex flex-col bg-zinc-900">
          
          {/* Error message */}
          <div className="relative flex-1 flex flex-col items-center justify-center p-8">
            <div className="flex flex-col items-center gap-5 text-center max-w-sm">
              {/* Red glow indicator */}
              <div className="relative">
                <div className="absolute inset-0 bg-red-500/20 rounded-full blur-xl" />
                <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-red-900/40 border border-red-500/30">
                  <AlertCircle className="h-8 w-8 text-red-400" />
                </div>
              </div>
              
              <div>
                <p className="text-lg font-medium text-zinc-200">
                  Something went wrong
                </p>
                <p className="text-sm text-zinc-500 mt-2">
                  There&apos;s an error in the generated code.
                  {onAskToFix && ' Click below to have AI fix it.'}
                </p>
              </div>

              {/* Actions */}
              <div className="flex flex-col items-center gap-3 w-full">
                {onAskToFix && (
                  <button
                    onClick={handleAskToFix}
                    className="flex items-center justify-center gap-2 w-full px-5 py-3 bg-amber-600 hover:bg-amber-500 rounded-xl text-sm font-medium text-white transition-colors"
                  >
                    <Wrench className="h-4 w-4" />
                    Ask AI to Fix
                  </button>
                )}
                
                <div className="flex items-center gap-2 w-full">
                  <button
                    onClick={handleRefresh}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm text-zinc-300 transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Retry
                  </button>
                  <button
                    onClick={() => setShowDebugPanel(true)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm text-zinc-300 transition-colors"
                  >
                    <Terminal className="h-4 w-4" />
                    View Details
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <SandpackProvider
        key={stableKey}
        template="react"
        theme={{
          colors: {
            surface1: '#18181b',
            surface2: '#27272a',
            surface3: '#3f3f46',
            clickable: '#a1a1aa',
            base: '#fafafa',
            disabled: '#52525b',
            hover: '#52525b',
            accent: '#f59e0b',
            error: '#ef4444',
            errorSurface: '#7f1d1d',
          },
          syntax: {
            plain: '#fafafa',
            comment: { color: '#71717a', fontStyle: 'italic' },
            keyword: '#f59e0b',
            tag: '#22d3ee',
            punctuation: '#a1a1aa',
            definition: '#a78bfa',
            property: '#fafafa',
            static: '#f59e0b',
            string: '#4ade80',
          },
          font: {
            body: '"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif',
            mono: '"Fira Code", "Fira Mono", Menlo, monospace',
            size: '14px',
            lineHeight: '1.6',
          },
        }}
        files={{
          '/App.js': wrapperCode,
          '/styles.css': `
@import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;500;600;700&display=swap');

* {
  font-family: 'Hanken Grotesk', ui-sans-serif, system-ui, -apple-system, sans-serif;
}

html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
  background-color: #18181b;
  color: #f4f4f5;
}
          `,
          '/index.js': `
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";

const root = createRoot(document.getElementById("root"));
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
          `,
        }}
        customSetup={{
          dependencies: {
            react: '^18.0.0',
            'react-dom': '^18.0.0',
            'lucide-react': '^0.454.0',
          },
        }}
        options={{
          externalResources: [
            'https://cdn.tailwindcss.com',
          ],
          classes: {
            'sp-wrapper': 'sp-custom-wrapper',
            'sp-layout': 'sp-custom-layout',
            'sp-stack': 'sp-custom-stack',
          },
          // Disable auto-reload to prevent constant flickering on errors
          autoReload: false,
        }}
      >
        {/* Error detector - uses Sandpack hook to detect errors */}
        <ErrorDetector onError={handleError} onStatusChange={handleStatusChange} />

        <SandpackLayout 
          className="!h-full !min-h-0 !bg-zinc-900 !border-0 !flex !flex-col"
          style={{ 
            // Completely hide content when error overlay is shown to prevent flickering
            display: (error && !showDebugPanel) ? 'none' : 'flex' 
          }}
        >
          {/* Main preview area */}
          <div className={`relative flex-1 min-h-0 ${showDebugPanel ? 'max-h-[60%]' : ''}`}>
            <SandpackPreview
              showOpenInCodeSandbox={false}
              showRefreshButton={false}
              actionsChildren={
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowDebugPanel(!showDebugPanel)}
                    className={`p-1.5 rounded transition-colors ${showDebugPanel ? 'bg-amber-600 text-white' : error ? 'bg-red-600 text-white' : 'hover:bg-zinc-700 text-zinc-400'}`}
                    title={showDebugPanel ? 'Hide debug panel' : 'Show debug panel'}
                  >
                    <Terminal className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handleRefresh}
                    className="p-1.5 hover:bg-zinc-700 rounded transition-colors"
                    title="Refresh widget"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              }
              style={{ height: '100%', minHeight: '200px', backgroundColor: '#18181b' }}
              onLoad={() => setIsLoading(false)}
            />
          </div>

          {/* Debug panel */}
          {showDebugPanel && (
            <div className="shrink-0 border-t border-zinc-700 bg-zinc-950">
              {/* Debug panel header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Terminal className="h-3.5 w-3.5" />
                  <span>Debug Console</span>
                  {error && (
                    <span className="px-2 py-0.5 bg-red-900/50 text-red-400 rounded text-[10px] font-medium">
                      ERROR
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {error && onAskToFix && (
                    <button
                      onClick={handleAskToFix}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-600 hover:bg-amber-500 rounded-lg text-xs text-white transition-colors"
                    >
                      <Wrench className="h-3 w-3" />
                      Ask to Fix
                    </button>
                  )}
                  <button
                    onClick={() => setShowDebugPanel(false)}
                    className="p-1 hover:bg-zinc-800 rounded transition-colors text-zinc-500 hover:text-zinc-300"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              <DebugPanel 
                error={error} 
                showCode={showCode}
                onToggleCode={() => setShowCode(!showCode)}
                componentCode={componentCode}
              />
            </div>
          )}
        </SandpackLayout>
      </SandpackProvider>
    </div>
  );
}
