// src/plugins/DataCubePlugin.tsx
import { useState, useEffect } from 'react';
import { useCore } from '../core/FViewerContext';
import { pluginManager } from '../core/PluginManager';
import { commandRegistry } from '../core/CommandRegistry';

const DataCubePluginComponent = () => {
    const { activeHdu, hduList, currentSlice, setCurrentSlice, fitsWorker, setImageData } = useCore();
    
    const [dragSlice, setDragSlice] = useState<number[]>([]);

    // 1. Register API Commands
    useEffect(() => {
        const ack = (cmd: any, sendReply: any) => sendReply({ message_id: cmd.message_id, status: 'ok' });
        const replyData = (cmd: any, sendReply: any, data: any) => sendReply({ message_id: cmd.message_id, ...data });

        commandRegistry.register('set_slice', async (command: any, sendReply: any) => {
            if (command.sliceIndices) {
                const newSlice = command.sliceIndices;
                setCurrentSlice(newSlice);
                try {
                    const img = await fitsWorker.readImage(newSlice);
                    setImageData(img);
                } catch (err) {
                    console.error("API Error: Failed to read image slice:", err);
                }
            }
            ack(command, sendReply);
        });

        commandRegistry.register('get_slice', async (command: any, sendReply: any) => {
            replyData(command, sendReply, { sliceIndices: currentSlice });
        });

        return () => {
            commandRegistry.unregister('set_slice');
            commandRegistry.unregister('get_slice');
        };
    }, [currentSlice, setCurrentSlice, fitsWorker, setImageData]);

    // Keep local drag state in sync with context
    useEffect(() => {
        setDragSlice(currentSlice);
    }, [currentSlice]);

    const targetHdu = hduList.find(h => h.index === activeHdu);
    
    // Hide entirely if it's not a data cube (MUST be after hooks)
    if (!targetHdu || targetHdu.type !== 'image' || !targetHdu.naxes || targetHdu.naxes.length <= 2) {
        return null; 
    }

    const naxes = targetHdu.naxes;

    const handleSliderDrag = (dimIndex: number, newValue: number) => {
        const newSlice = [...dragSlice];
        newSlice[dimIndex] = newValue;
        setDragSlice(newSlice);
    };

    const handleSliderRelease = async () => {
        setCurrentSlice(dragSlice);
        try {
            const img = await fitsWorker.readImage(dragSlice);
            setImageData(img);
        } catch (err) {
            console.error("Failed to read image slice:", err);
        }
    };

    // 2. Return the UI for the FitsImage Toolbar
    return (
        <div className="dropdown ms-2 border-start ps-2 d-flex align-items-center" style={{ borderColor: 'var(--fv-border)' }}>
            <button 
                className="btn menubar-btn fv-text-bright dropdown-toggle d-flex align-items-center" 
                type="button" 
                data-bs-toggle="dropdown" 
                data-bs-auto-close="outside"
                title="Data Cube Slices"
                style={{ fontSize: '0.85rem' }}
            >
                <i className="bi bi-box me-1"></i> Cube
            </button>
            
            <div className="dropdown-menu fv-dropdown-menu shadow p-3" style={{ minWidth: '220px' }}>
                <h6 className="dropdown-header px-1 text-uppercase" style={{ fontSize: '0.7rem', letterSpacing: '0.5px' }}>
                    Cube Dimensions
                </h6>
                
                {naxes.slice(2).map((dimSize: number, idx: number) => {
                    const axisName = idx === 0 ? 'Z' : idx === 1 ? 'W' : `Dim ${idx + 3}`;
                    const currentVal = dragSlice[idx] || 1;
                    
                    return (
                        <div key={idx} className="mt-2">
                            <div className="d-flex justify-content-between font-monospace mb-1 fv-text-bright" style={{ fontSize: '0.8rem' }}>
                                <span>{axisName} Axis</span>
                                <span className="text-info fw-bold">{currentVal} <span className="text-muted fw-normal">/ {dimSize}</span></span>
                            </div>
                            <input 
                                type="range" 
                                className="form-range" 
                                min="1" 
                                max={dimSize} 
                                step="1" 
                                value={currentVal}
                                onChange={(e) => handleSliderDrag(idx, parseInt(e.target.value, 10))}
                                onMouseUp={handleSliderRelease}
                                onTouchEnd={handleSliderRelease}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export function initDataCubePlugin() {
    pluginManager.registerUI('fitsimage:toolbar', <DataCubePluginComponent />);
}