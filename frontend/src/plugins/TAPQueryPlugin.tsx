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
    const handleContextQuery = async (tableName: string, label: string, tapUrl: string) => {
        if (!imageData) return;
        setIsFetching(true);
        
        try {
            let adqlCondition = "";
            const activeRegion = regions.find(r => r.id === selectedRegionId);
            const imgH = imageData.height; // Use this to flip the Y-axis!

            // --- MATH HELPERS ---
            // 1. Rotate a 2D point around a center
            const rotatePoint = (x: number, y: number, cx: number, cy: number, angleDeg: number) => {
                const rad = angleDeg * (Math.PI / 180);
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);
                return {
                    x: cos * (x - cx) - sin * (y - cy) + cx,
                    y: sin * (x - cx) + cos * (y - cy) + cy
                };
            };

            // 2. Convert a pixel radius to true WCS degrees using Haversine
            const getDegRadius = async (cx: number, cy: number, rPx: number) => {
                // FLIP THE Y-AXIS FOR WCS!
                const c_wcs = await fitsWorker.pixToWorld(cx, imgH - cy);
                const e_wcs = await fitsWorker.pixToWorld(cx + rPx, imgH - cy);
                
                const ra1 = c_wcs.ra * (Math.PI / 180);
                const dec1 = c_wcs.dec * (Math.PI / 180);
                const ra2 = e_wcs.ra * (Math.PI / 180);
                const dec2 = e_wcs.dec * (Math.PI / 180);
                
                const a = Math.sin((dec2 - dec1) / 2) ** 2 + 
                          Math.cos(dec1) * Math.cos(dec2) * Math.sin((ra2 - ra1) / 2) ** 2;
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                return { center: c_wcs, radiusDeg: c * (180 / Math.PI) };
            };

            if (activeRegion) {
                if (activeRegion.type === 'box') {
                    // Box: Calculate 4 corners, rotate, and send as POLYGON
                    const cx = (activeRegion.startX + activeRegion.endX) / 2;
                    const cy = (activeRegion.startY + activeRegion.endY) / 2;
                    const minX = Math.min(activeRegion.startX, activeRegion.endX);
                    const maxX = Math.max(activeRegion.startX, activeRegion.endX);
                    const minY = Math.min(activeRegion.startY, activeRegion.endY);
                    const maxY = Math.max(activeRegion.startY, activeRegion.endY);
                    
                    const cornersPx = [
                        { x: minX, y: minY }, { x: maxX, y: minY },
                        { x: maxX, y: maxY }, { x: minX, y: maxY }
                    ].map(p => rotatePoint(p.x, p.y, cx, cy, activeRegion.angle || 0));

                    // FLIP THE Y-AXIS FOR ALL CORNERS!
                    const wcsPts = await Promise.all(cornersPx.map(p => fitsWorker.pixToWorld(p.x, imgH - p.y)));
                    const polyStr = wcsPts.map(p => `${p.ra}, ${p.dec}`).join(', ');
                    adqlCondition = `CONTAINS(POINT('ICRS', ra, dec), POLYGON('ICRS', ${polyStr})) = 1`;

                } else if (activeRegion.type === 'ellipse') {
                    // Ellipse: Approx with 32 rotated points along the perimeter
                    const cx = activeRegion.startX;
                    const cy = activeRegion.startY;
                    const rx = Math.abs(activeRegion.endX - activeRegion.startX);
                    const ry = Math.abs(activeRegion.endY - activeRegion.startY);
                    
                    const ptsPx = [];
                    for (let i = 0; i < 32; i++) {
                        const theta = (i / 32) * 2 * Math.PI;
                        const px = cx + rx * Math.cos(theta);
                        const py = cy + ry * Math.sin(theta);
                        ptsPx.push(rotatePoint(px, py, cx, cy, activeRegion.angle || 0));
                    }
                    
                    // FLIP THE Y-AXIS FOR ALL PERIMETER POINTS!
                    const wcsPts = await Promise.all(ptsPx.map(p => fitsWorker.pixToWorld(p.x, imgH - p.y)));
                    const polyStr = wcsPts.map(p => `${p.ra}, ${p.dec}`).join(', ');
                    adqlCondition = `CONTAINS(POINT('ICRS', ra, dec), POLYGON('ICRS', ${polyStr})) = 1`;

                } else if (activeRegion.type === 'annulus') {
                    // Annulus: Outer circle matches = 1 AND Inner circle matches = 0
                    const cx = activeRegion.startX;
                    const cy = activeRegion.startY;
                    const outerPx = Math.hypot(activeRegion.endX - activeRegion.startX, activeRegion.endY - activeRegion.startY);
                    const innerPx = activeRegion.innerR ?? (outerPx * 0.5);

                    const { center, radiusDeg: rOuter } = await getDegRadius(cx, cy, outerPx);
                    const { radiusDeg: rInner } = await getDegRadius(cx, cy, innerPx);

                    adqlCondition = `(CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${center.ra}, ${center.dec}, ${rOuter})) = 1 ` +
                                    `AND CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${center.ra}, ${center.dec}, ${rInner})) = 0)`;

                } else {
                    // Circle (Default)
                    const cx = activeRegion.startX;
                    const cy = activeRegion.startY;
                    const rPx = Math.hypot(activeRegion.endX - activeRegion.startX, activeRegion.endY - activeRegion.startY);
                    
                    const { center, radiusDeg } = await getDegRadius(cx, cy, rPx);
                    adqlCondition = `CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${center.ra}, ${center.dec}, ${radiusDeg})) = 1`;
                }
            } else {
                // Full Image: 4 Corners Polygon (FLIP Y HERE TOO)
                const wcsPts = await Promise.all([
                    fitsWorker.pixToWorld(0, imgH - 0),
                    fitsWorker.pixToWorld(imageData.width, imgH - 0),
                    fitsWorker.pixToWorld(imageData.width, imgH - imageData.height),
                    fitsWorker.pixToWorld(0, imgH - imageData.height)
                ]);
                const polyStr = wcsPts.map(p => `${p.ra}, ${p.dec}`).join(', ');
                adqlCondition = `CONTAINS(POINT('ICRS', ra, dec), POLYGON('ICRS', ${polyStr})) = 1`;
            }

            // Build ADQL and execute
            const adql = `SELECT * FROM ${tableName} WHERE ${adqlCondition}`;
            await executeQuery(tapUrl, adql, label, false);
            
        } catch (err: any) {
            alert(`Context Query Error: ${err.message}`);
            setIsFetching(false);
        }
    };

    const heasarcTap = "https://heasarc.gsfc.nasa.gov/xamin/vo/tap";
    const irsaTap = "https://irsa.ipac.caltech.edu/TAP";
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
                            onClick={() => handleContextQuery('csc', 'Chandra Source Catalog', heasarcTap)}
                        >
                            HEASARC Chandra
                        </button>
                    </li>
                    <li>
                        <button 
                            className={`dropdown-item fv-dropdown-item d-flex align-items-center ${!imageData ? 'disabled fv-text-muted' : ''}`} 
                            onClick={() => handleContextQuery('xmmssc', 'XMM Serendipitous Source Catalog', heasarcTap)}
                        >
                            HEASARC XMM
                        </button>
                    </li>
                    <li>
                        <button 
                            className={`dropdown-item fv-dropdown-item d-flex align-items-center ${!imageData ? 'disabled fv-text-muted' : ''}`} 
                            onClick={() => handleContextQuery('ztf_objects_dr24', 'ZTF DR24', irsaTap)}
                        >
                            ZTF DR24
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