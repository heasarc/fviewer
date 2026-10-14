// src/plugins/ServerFilePlugin.tsx
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { useCore } from '../core/FViewerContext';
import { pluginManager } from '../core/PluginManager';
import { getApiUrl } from '../hooks/useWebSocket';
import { parseDS9Regions } from '../utils/regionUtils';
import { ServerFileModal } from '../components/ServerFileModal';

const ServerFilePluginComponent = () => {
    const { processFile, isConnected, setIsLoading, imageData, fitsWorker,
        setRegions, serverModalMode, setServerModalMode } = useCore();
    const [feedback, setFeedback] = useState<{ type: 'error' | 'success' | 'info'; message: string; retry?: () => void } | null>(null);

    useEffect(() => {
        if (!feedback) return;
        const timer = window.setTimeout(() => setFeedback(null), 4000);
        return () => window.clearTimeout(timer);
    }, [feedback]);

    // Server File listing
    const handleServerFileSelect = async (serverPath: string) => {
        try {
            setIsLoading(true);
            const response = await fetch(getApiUrl(`api/file?path=${encodeURIComponent(serverPath)}`));
            if (!response.ok) throw new Error('Failed to load file from server.');
            
            // Route based on the mode
            if (serverModalMode === 'region' || serverPath.endsWith('.reg')) {
                if (!imageData) throw new Error("No image data available for region coordinate conversion.");
                const text = await response.text();

                // Extract physical transform parameters with safe defaults
                const physicalTransform = {
                    ltv1: imageData.ltv1 ?? 0,
                    ltv2: imageData.ltv2 ?? 0,
                    ltm1_1: imageData.ltm1_1 ?? 1,
                    ltm2_2: imageData.ltm2_2 ?? 1
                };
                const newRegions = await parseDS9Regions(
                    text, imageData.width, imageData.height, 
                    fitsWorker.pixToWorld, fitsWorker.worldToPix,
                    physicalTransform
                );
                setRegions((prev: any[]) => [...prev, ...newRegions]);
            } else {
                const blob = await response.blob();
                const filename = serverPath.split('/').pop() || 'remote.fits';
                const file = new File([blob], filename, { type: 'application/octet-stream' });
                await processFile(file);
            }
        } catch (error) {
            console.error("Error loading server file:", error);
            setFeedback({
                type: 'error',
                message: error instanceof Error && error.message ? error.message : 'Failed to load file from server.',
                retry: () => handleServerFileSelect(serverPath)
            });
        } finally {
            setIsLoading(false);
            setServerModalMode(null);
        }
    };

    return (
        <>
            {feedback && (
                <div
                    className={`position-fixed top-0 end-0 m-3 px-3 py-2 rounded border shadow-sm small ${feedback.type === 'error' ? 'bg-danger text-white border-danger' : 'bg-success text-white border-success'}`}
                    style={{ zIndex: 2000, maxWidth: '22rem' }}
                >
                    <div className="d-flex justify-content-between align-items-center gap-2">
                        <span>{feedback.message}</span>
                        {feedback.retry && (
                            <button type="button" className="btn btn-link btn-sm p-0 text-white" onClick={feedback.retry}>Retry</button>
                        )}
                    </div>
                </div>
            )}

            {isConnected && (
                <li>
                    <button className="dropdown-item fv-dropdown-item" onClick={() => setServerModalMode('fits')}>
                        <i className="bi bi-plug-fill"></i> Open From Server...
                    </button>
                </li>
            )}

            {createPortal(
                <ServerFileModal 
                    isOpen={serverModalMode !== null}
                    mode={serverModalMode}
                    onClose={() => setServerModalMode(null)} // Uses context setter
                    onFileSelect={handleServerFileSelect}
                />,
                document.body
            )}
        </>
    );
};

export function initServerFilePlugin() {
    pluginManager.registerUI('menubar:file', <ServerFilePluginComponent />);
}