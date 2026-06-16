// src/plugins/TAPQueryPlugin.tsx
import { useState } from 'react';
import { useCore } from '../core/FViewerContext';
import { pluginManager } from '../core/PluginManager';

const TAPQueryMenu = () => {
    const { 
        voWorker, fitsWorker,
        setActiveDataType, setTableInfo, setActiveHdu, setFileName, setIsLoading,
        imageData, regions, selectedRegionId
    } = useCore();

    const [isOpen, setIsOpen] = useState(false);
    const [tapUrl, setTapUrl] = useState('https://heasarc.gsfc.nasa.gov/xamin/vo/tap');
    const [query, setQuery] = useState("SELECT TOP 100 name,ra,dec FROM numaster");
    const [isFetching, setIsFetching] = useState(false);

    // General handler for both manual ADQL and automatic Image overlays
    const executeQuery = async (targetUrl: string, adqlQuery: string, label: string, clearImage: boolean = true) => {
        setIsFetching(true);
        setIsLoading(true);
        
        try {
            // 1. Fetch via our FastAPI proxy to bypass CORS
            const response = await fetch(`/api/tap-proxy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: targetUrl, query: adqlQuery })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Proxy Error: ${response.status}`);
            }
            
            const data = await response.json();
            const xmlString = data.xmlString;

            // 2. Pass to the VO worker
            const result = await voWorker.loadVOTableString(xmlString);
            
            // 3. Map the worker's metadata to the format VirtualTable expects
            const { numRows, numCols, colNames } = result.metadata;
            const columns = colNames.map((name: string) => ({ name, unit: '', form: '' }));

            // 4. Update the global UI State
            setTableInfo({ numRows, numCols, columns });
            setActiveDataType('votable');
            setFileName(`Catalog: ${label}`);
            
            // CRITICAL: If clearImage is false, we LEAVE activeHdu alone! 
            // This causes App.tsx to render BOTH the FitsImage AND the VirtualTable!
            if (clearImage) {
                setActiveHdu(null); 
            }
            
            setIsOpen(false);
        } catch (error: any) {
            console.error("TAP Query Failed:", error);
            alert(`Query Failed: ${error.message}`);
        } finally {
            setIsFetching(false);
            setIsLoading(false);
        }
    };

    // Context-Aware spatial query builder
    const handleContextQuery = async (tableName: string, label: string) => {
        if (!imageData) return;
        setIsFetching(true);
        
        try {
            // 1. Get pixel scale (assume degrees/pixel)
            let pxToDeg = 1 / 3600; // Default to 1 arcsec if WCS fails
            try {
                const scale = await fitsWorker.getPixScale();
                if (scale && scale.length > 0) pxToDeg = Math.abs(scale[0]);
            } catch (e) { console.warn("No WCS Scale found, using default"); }

            let shapeAdql = "";
            const activeRegion = regions.find(r => r.id === selectedRegionId);

            if (activeRegion) {
                // REGION SELECTED -> Query specific area
                let cx = 0, cy = 0;
                if (activeRegion.type === 'box') {
                    cx = (activeRegion.startX + activeRegion.endX) / 2;
                    cy = (activeRegion.startY + activeRegion.endY) / 2;
                    const w = Math.abs(activeRegion.endX - activeRegion.startX) * pxToDeg;
                    const h = Math.abs(activeRegion.endY - activeRegion.startY) * pxToDeg;
                    const wcs = await fitsWorker.pixToWorld(cx, cy);
                    shapeAdql = `BOX('ICRS', ${wcs.ra}, ${wcs.dec}, ${w}, ${h})`;
                } else {
                    // Circle, Ellipse, Annulus -> Default to Circle
                    cx = activeRegion.startX; cy = activeRegion.startY;
                    const radiusPx = Math.hypot(activeRegion.endX - activeRegion.startX, activeRegion.endY - activeRegion.startY);
                    const wcs = await fitsWorker.pixToWorld(cx, cy);
                    shapeAdql = `CIRCLE('ICRS', ${wcs.ra}, ${wcs.dec}, ${radiusPx * pxToDeg})`;
                }
            } else {
                // NO REGION -> Query whole image bounding box
                const cx = imageData.width / 2;
                const cy = imageData.height / 2;
                const w = imageData.width * pxToDeg;
                const h = imageData.height * pxToDeg;
                const wcs = await fitsWorker.pixToWorld(cx, cy);
                shapeAdql = `BOX('ICRS', ${wcs.ra}, ${wcs.dec}, ${w}, ${h})`;
            }

            // Build ADQL and execute
            const adql = `SELECT * FROM ${tableName} WHERE CONTAINS(POINT('ICRS', ra, dec), ${shapeAdql}) = 1`;
            await executeQuery('https://heasarc.gsfc.nasa.gov/xamin/vo/tap', adql, label, false); // clearImage = false
            
        } catch (err: any) {
            alert(`Context Query Error: ${err.message}`);
            setIsFetching(false);
        }
    };

    return (
        <>
            {/* The Catalogs Dropdown Menu */}
            <li className="nav-item dropdown">
                <button 
                    className="btn menubar-btn text-start w-100 px-3 py-2 py-md-0 d-flex align-items-center" 
                    style={{ fontSize: '0.85rem', height: '36px', color: 'var(--fv-text)' }} 
                    data-bs-toggle="dropdown"
                >
                    Catalogs
                </button>
                <ul className="dropdown-menu fv-dropdown-menu shadow position-absolute">
                    {/* 1. Manual Query */}
                    <li>
                        <button className="dropdown-item fv-dropdown-item d-flex align-items-center" onClick={() => setIsOpen(true)}>
                            <i className="bi bi-code-square me-2 fv-text-primary"></i> Manual ADQL Search
                        </button>
                    </li>
                    
                    {/* 2. Context-Aware Queries (Only active if an image is loaded) */}
                    <li><hr className="dropdown-divider border-secondary my-1" /></li>
                    <li><h6 className="dropdown-header text-uppercase" style={{ fontSize: '0.65rem' }}>Image Overlays</h6></li>
                    
                    <li>
                        <button 
                            className={`dropdown-item fv-dropdown-item d-flex align-items-center ${!imageData ? 'disabled fv-text-muted' : ''}`} 
                            onClick={() => handleContextQuery('csc', 'Chandra Source Catalog')}
                        >
                            <i className="bi bi-stars me-2 text-warning"></i> HEASARC Chandra
                        </button>
                    </li>
                    <li>
                        <button 
                            className={`dropdown-item fv-dropdown-item d-flex align-items-center ${!imageData ? 'disabled fv-text-muted' : ''}`} 
                            onClick={() => handleContextQuery('xmmssc', 'XMM Serendipitous Source Catalog ')}
                        >
                            <i className="bi bi-stars me-2 text-warning"></i> HEASARC XMM
                        </button>
                    </li>
                </ul>
            </li>

            {/* The ADQL Query Modal */}
            {isOpen && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1050 }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content text-white" style={{ backgroundColor: 'var(--fv-panel)', borderColor: 'var(--fv-border)' }}>
                            <div className="modal-header border-bottom" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                                <h5 className="modal-title" style={{ fontSize: '1rem' }}><i className="bi bi-search me-2"></i> Remote TAP Query</h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setIsOpen(false)}></button>
                            </div>
                            <div className="modal-body">
                                <div className="mb-3">
                                    <label className="form-label" style={{ fontSize: '0.85rem' }}>TAP Service URL</label>
                                    <input type="text" className="form-control form-control-sm bg-dark text-white border-secondary" value={tapUrl} onChange={(e) => setTapUrl(e.target.value)} />
                                </div>
                                <div className="mb-3">
                                    <label className="form-label" style={{ fontSize: '0.85rem' }}>ADQL Query</label>
                                    <textarea className="form-control form-control-sm bg-dark text-white border-secondary font-monospace" rows={4} value={query} onChange={(e) => setQuery(e.target.value)} />
                                </div>
                            </div>
                            <div className="modal-footer border-top-0">
                                <button className="btn btn-sm btn-outline-secondary" onClick={() => setIsOpen(false)}>Cancel</button>
                                <button className="btn btn-sm btn-primary" onClick={() => executeQuery(tapUrl, query, 'Manual Query', true)} disabled={isFetching}>
                                    {isFetching ? 'Querying...' : 'Run Query'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export function initTAPQueryPlugin() {
    pluginManager.registerUI('menubar:menus', <TAPQueryMenu />);
}