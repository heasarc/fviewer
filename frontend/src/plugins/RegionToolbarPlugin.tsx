import React, { useState, useRef, useEffect } from 'react';
import { useCore } from '../core/FViewerContext';
import { pluginManager } from '../core/PluginManager';
import { parseDS9Regions, serializeDS9Regions } from '../utils/regionUtils';

const DRAW_MODE_INFO: Record<string, { label: string; icon: string }> = {
    pan: { label: 'Pointer / Pan', icon: 'bi-arrows-move' },
    circle: { label: 'Circle', icon: 'bi-circle' },
    box: { label: 'Box', icon: 'bi-square' },
    ellipse: { label: 'Ellipse', icon: 'bi-circle' },
    annulus: { label: 'Annulus', icon: 'bi-bullseye' },
};

const RegionToolbarPluginComponent = () => {
    const { 
        drawMode, setDrawMode, 
        selectedRegionId, setSelectedRegionId, 
        deleteSelectedRegion, 
        regions, setRegions, 
        isConnected, setServerModalMode, 
        imageData, fitsWorker, fileName 
    } = useCore();

    const [saveFormat, setSaveFormat] = useState<'image' | 'physical' | 'fk5'>('image');
    const [feedback, setFeedback] = useState<{ type: 'error' | 'success' | 'info'; message: string; retry?: () => void } | null>(null);
    const regionInputRef = useRef<HTMLInputElement>(null);
    const toggleRef = useRef<HTMLButtonElement>(null);

    // Close the menu after an action; the Save format select and disabled items keep it open.
    const closeMenuOnSelect = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        const button = target.closest('button');
        if (!button || button.disabled) return;
        if (toggleRef.current?.getAttribute('aria-expanded') === 'true') toggleRef.current.click();
    };

    useEffect(() => {
        if (drawMode === 'pan') return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            const tag = (e.target as HTMLElement | null)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            setDrawMode('pan');
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [drawMode, setDrawMode]);

    // Get the currently selected region
    const selectedRegion = regions.find((r: any) => r.id === selectedRegionId);

    // --- REGION FILE I/O ---
    const handleSaveRegions = async (format: 'image' | 'physical' | 'fk5' = 'fk5') => {
        if (regions.length === 0) {
            setFeedback({ type: 'error', message: 'No regions to save.' });
            return;
        }
        if (!imageData) {
            setFeedback({ type: 'error', message: 'No image data loaded.' });
            return;
        }

        try {
            const physicalTransform = {
                ltv1: imageData.ltv1 ?? 0, ltv2: imageData.ltv2 ?? 0,
                ltm1_1: imageData.ltm1_1 ?? 1, ltm2_2: imageData.ltm2_2 ?? 1
            };
            
            const fileContent = await serializeDS9Regions(
                regions, format, imageData.width, imageData.height, fitsWorker.pixToWorld,
                imageData.pixScale || null, physicalTransform
            );

            const blob = new Blob([fileContent], { type: 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${fileName ? fileName.replace(/\.fits$/i, '') : 'fviewer'}.reg`;
            a.click();
            URL.revokeObjectURL(a.href);
            setFeedback({ type: 'success', message: `Saved ${regions.length} region${regions.length === 1 ? '' : 's'} to disk.` });
        } catch (error) {
            setFeedback({
                type: 'error',
                message: 'Unable to save regions.',
                retry: () => handleSaveRegions(format)
            });
        }
    };

    const handleLoadRegions = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !imageData) {
            setFeedback({ type: 'error', message: imageData ? 'Select a region file to load.' : 'Load a FITS file before importing regions.' });
            return;
        }

        try {
            const physicalTransform = {
                ltv1: imageData.ltv1 ?? 0, ltv2: imageData.ltv2 ?? 0,
                ltm1_1: imageData.ltm1_1 ?? 1, ltm2_2: imageData.ltm2_2 ?? 1
            };

            const text = await file.text(); 
            const loadedRegions = await parseDS9Regions(
                text, imageData.width, imageData.height, fitsWorker.pixToWorld, fitsWorker.worldToPix,
                physicalTransform
            );
            
            setRegions((prev: any[]) => [...prev, ...loadedRegions]);
            setFeedback({ type: 'success', message: `Loaded ${loadedRegions.length} region${loadedRegions.length === 1 ? '' : 's'}.` });
            if (regionInputRef.current) regionInputRef.current.value = ''; 
        } catch (error) {
            setFeedback({ type: 'error', message: `Unable to read ${file.name}.`, retry: () => handleLoadRegions(e) });
        }
    };

    return (
        <div className="d-flex gap-1 me-2 align-items-center">
            {/* Hidden Input for Local Loading */}
            <input type="file" ref={regionInputRef} accept=".reg,.txt" style={{ display: 'none' }} onChange={handleLoadRegions} />

            <div className="dropdown">
                <button ref={toggleRef} className={`fv-btn dropdown-toggle ${drawMode !== 'pan' ? 'active' : ''}`} data-bs-toggle="dropdown" title="Regions Menu">
                    <i className={`bi ${DRAW_MODE_INFO[drawMode]?.icon ?? 'bi-bounding-box'}`}></i>{' '}
                    <span className="ms-1" data-testid="draw-mode-label">
                        {drawMode === 'pan' ? 'Regions' : `Draw: ${DRAW_MODE_INFO[drawMode]?.label ?? drawMode}`}
                    </span>
                </button>
                <ul className="dropdown-menu fv-dropdown-menu shadow" onClick={closeMenuOnSelect}>
                    
                    {/* DRAWING MODES */}
                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => setDrawMode('pan')}><span style={{ width: '16px' }}>{drawMode === 'pan' && <i className="bi bi-check2"></i>}</span><i className="bi bi-arrows-move"></i> Pointer / Pan</button></li>
                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => setDrawMode('circle')}><span style={{ width: '16px' }}>{drawMode === 'circle' && <i className="bi bi-check2"></i>}</span><i className="bi bi-circle"></i> Circle</button></li>
                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => setDrawMode('box')}><span style={{ width: '16px' }}>{drawMode === 'box' && <i className="bi bi-check2"></i>}</span><i className="bi bi-square"></i> Box</button></li>
                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => setDrawMode('ellipse')}><span style={{ width: '16px' }}>{drawMode === 'ellipse' && <i className="bi bi-check2"></i>}</span><span style={{ transform: 'scaleY(0.7)', display: 'inline-block' }}><i className="bi bi-circle"></i></span> Ellipse</button></li>
                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => setDrawMode('annulus')}><span style={{ width: '16px' }}>{drawMode === 'annulus' && <i className="bi bi-check2"></i>}</span><i className="bi bi-bullseye"></i> Annulus</button></li>

                    {/* REGION PROPERTIES */}
                    <li><hr className="dropdown-divider border-secondary my-1" /></li>
                    <li>
                        <button 
                            className="dropdown-item fv-dropdown-item" 
                            onClick={() => {
                                if (selectedRegionId) {
                                    setRegions((prev: any[]) => prev.map(r => r.id === selectedRegionId ? { ...r, isBackground: !r.isBackground } : r));
                                }
                            }} 
                            disabled={!selectedRegionId}
                        >
                            <span style={{ width: '16px' }}>{selectedRegion?.isBackground && <i className="bi bi-check2"></i>}</span>
                            <i className="bi bi-dash-circle-dotted"></i> Set as Background
                        </button>
                    </li>

                    {/* DELETION */}
                    <li><hr className="dropdown-divider border-secondary my-1" /></li>
                    <li><button className={`dropdown-item fv-dropdown-item ${selectedRegionId ? 'text-warning' : ''}`} onClick={deleteSelectedRegion} disabled={!selectedRegionId}><span style={{ width: '16px' }}></span><i className="bi bi-eraser"></i> Delete Selected (Del)</button></li>
                    <li><button className={`dropdown-item fv-dropdown-item ${regions.length > 0 ? 'text-danger' : ''}`} onClick={() => { setRegions([]); setSelectedRegionId(null); }} disabled={regions.length === 0}><span style={{ width: '16px' }}></span><i className="bi bi-trash"></i> Clear All Regions</button></li>
                    
                    {/* FILE I/O */}
                    <li><hr className="dropdown-divider border-secondary my-1" /></li>
                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => regionInputRef.current?.click()}><span style={{ width: '16px' }}></span><i className="bi bi-folder2-open"></i> Load Local Regions...</button></li>
                    {isConnected && (                                    
                        <li><button className="dropdown-item fv-dropdown-item" onClick={() => setServerModalMode('region')}><span style={{ width: '16px' }}></span><i className="bi bi-cloud-arrow-down"></i> Load Server Regions...</button></li>
                    )}
                    
                    {/* SAVE CONTROLS */}
                    <li><hr className="dropdown-divider border-secondary my-1" /></li>
                    <li className="px-3 py-1">
                        <label className="fv-text-muted mb-1" style={{ fontSize: '0.75rem' }}>Save Regions</label>
                        <div className="input-group input-group-sm">
                            <select className="form-select border-secondary bg-dark text-white" value={saveFormat} onChange={(e) => setSaveFormat(e.target.value as any)} disabled={regions.length === 0}>
                                <option value="image">Image</option>
                                <option value="physical">Physical</option>
                                <option value="fk5" disabled={!(imageData?.pixScale)}>FK5</option>
                            </select>
                            <button className="btn btn-outline-secondary" onClick={() => handleSaveRegions(saveFormat)} disabled={regions.length === 0 || (saveFormat === 'fk5' && !(imageData?.pixScale))}><i className="bi bi-download"></i> Save</button>
                        </div>
                    </li>
                </ul>
            </div>
            {drawMode !== 'pan' && (
                <button className="fv-btn" title="Return to Pointer / Pan (Esc)" onClick={() => setDrawMode('pan')}>
                    <i className="bi bi-arrows-move"></i> <span className="ms-1">Pan</span>
                </button>
            )}
            {feedback && (
                <div className={`small rounded px-2 py-1 mt-2 border ${feedback.type === 'error' ? 'border-danger text-danger bg-danger-subtle' : 'border-success text-success bg-success-subtle'}`}>
                    <span>{feedback.message}</span>
                    {feedback.retry && (
                        <button type="button" className="btn btn-link btn-sm p-0 ms-2" onClick={feedback.retry}>Retry</button>
                    )}
                </div>
            )}
        </div>
    );
};

export function initRegionToolbarPlugin() {
    // Notice we assign this to a new slot for the LEFT side of the toolbar
    pluginManager.registerUI('fitsimage:toolbar:left', <RegionToolbarPluginComponent />);
}