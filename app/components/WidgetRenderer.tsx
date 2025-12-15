'use client';

import { useEffect, useState, useCallback } from 'react';
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
function createWrapperCode(componentCode: string, data: unknown[]): string {
  const cleanedCode = stripExports(componentCode);
  
  return `
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

// Generated Widget Component
${cleanedCode}

// Data passed from parent
const initialData = ${JSON.stringify(data)};

// Wrapper that handles data state and communication
function App() {
  const [data, setData] = React.useState(initialData);

  const handleDataChange = React.useCallback((newData) => {
    setData(newData);
    // Send message to parent window
    window.parent.postMessage({
      type: 'WIDGET_DATA_CHANGE',
      data: newData
    }, '*');
  }, []);

  return (
    <div className="min-h-screen bg-zinc-900 p-4">
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
  const [key, setKey] = useState(0); // For forcing re-render

  // Extract just the data values
  const dataArray = dataItems.map((item) => item.data);

  // Handle messages from the sandboxed widget
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'WIDGET_DATA_CHANGE' && onDataChange) {
        const newDataArray = event.data.data as Record<string, unknown>[];
        // Map back to WidgetData format, preserving IDs where possible
        const updatedDataItems: WidgetData[] = newDataArray.map((data, index) => ({
          id: dataItems[index]?.id || `new-${index}`,
          data,
        }));
        onDataChange(updatedDataItems);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [dataItems, onDataChange]);

  // Create the wrapper code
  const wrapperCode = createWrapperCode(componentCode, dataArray);

  const handleRefresh = useCallback(() => {
    setKey((k) => k + 1);
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
    <div className={`relative overflow-hidden rounded-lg ${className}`}>
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
        key={key}
        template="react"
        theme="dark"
        files={{
          '/App.js': wrapperCode,
        }}
        customSetup={{
          dependencies: {
            react: '^18.0.0',
            'react-dom': '^18.0.0',
          },
        }}
        options={{
          classes: {
            'sp-wrapper': 'sp-custom-wrapper',
            'sp-layout': 'sp-custom-layout',
            'sp-stack': 'sp-custom-stack',
          },
          externalResources: [
            'https://cdn.tailwindcss.com',
          ],
        }}
      >
        <SandpackLayout>
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
            style={{ height: '400px', minHeight: '300px' }}
            onLoad={() => setIsLoading(false)}
          />
        </SandpackLayout>
      </SandpackProvider>
    </div>
  );
}

