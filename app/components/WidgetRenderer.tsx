'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  SandpackProvider,
  SandpackPreview,
  SandpackLayout,
} from '@codesandbox/sandpack-react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';

type WidgetData = {
  id: string;
  data: Record<string, unknown>;
};

type WidgetRendererProps = {
  widgetId: string;
  componentCode: string;
  dataItems: WidgetData[];
  onDataChange?: (dataItems: WidgetData[]) => void;
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
    <div style={{ fontFamily: "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif" }} className="min-h-screen bg-zinc-900 p-6 antialiased text-zinc-100">
      <Widget data={data} onDataChange={handleDataChange} />
    </div>
  );
}

export default App;
`;
}


export default function WidgetRenderer({
  widgetId,
  componentCode,
  dataItems,
  onDataChange,
  className = '',
}: WidgetRendererProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forceRefreshCount, setForceRefreshCount] = useState(0);
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
  }, []);

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
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-800 z-10">
          <div className="flex flex-col items-center gap-3 text-zinc-400">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Loading widget...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-800 z-10">
          <div className="flex flex-col items-center gap-3 text-red-400 p-4 text-center">
            <AlertCircle className="h-8 w-8" />
            <p className="text-sm">{error}</p>
            <button
              onClick={handleRefresh}
              className="flex items-center gap-2 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm text-zinc-200 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
          </div>
        </div>
      )}

      <SandpackProvider
        key={stableKey}
        template="react"
        theme="dark"
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
        }}
      >
        <SandpackLayout className="!h-full !min-h-0">
          <SandpackPreview
            showOpenInCodeSandbox={false}
            showRefreshButton={false}
            actionsChildren={
              <button
                onClick={handleRefresh}
                className="p-1.5 hover:bg-zinc-700 rounded transition-colors"
                title="Refresh widget"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            }
            style={{ height: '100%', minHeight: '300px' }}
            onLoad={() => setIsLoading(false)}
          />
        </SandpackLayout>
      </SandpackProvider>
    </div>
  );
}

