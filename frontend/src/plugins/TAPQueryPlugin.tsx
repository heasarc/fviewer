// src/plugins/TAPQueryPlugin.tsx
import { useState } from 'react';
import { useCore } from '../core/FViewerContext';
import { pluginManager } from '../core/PluginManager';

const TAPQueryMenu = () => {
    const { 
        voWorker, 
        setActiveDataType, 
        setTableInfo, 
        setActiveHdu, 
        setFileName,
        setIsLoading
    } = useCore();

    const [isOpen, setIsOpen] = useState(false);
    const [tapUrl, setTapUrl] = useState('https://heasarc.gsfc.nasa.gov/xamin/vo/tap');
    const [query, setQuery] = useState("SELECT TOP 100 name,ra,dec FROM numaster");
    const [isFetching, setIsFetching] = useState(false);

    const handleSearch = async () => {
        setIsFetching(true);
        setIsLoading(true);
        
        try {
            // 1. Fetch via our FastAPI proxy to bypass CORS
            const response = await fetch(`/api/tap-proxy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: tapUrl,
                    query: query
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Proxy Error: ${response.status}`);
            }
            
            const data = await response.json();
            const xmlString = data.xmlString;

            // 2. Pass to our Rust WASM worker
            const result = await voWorker.loadVOTableString(xmlString);

            console.log("Worker returned:", result);
            
            // 3. Map the worker's metadata to the format VirtualTable expects
            const { numRows, numCols, colNames } = result.metadata;
            const columns = colNames.map((name: string) => ({ name, unit: '', form: '' }));

            // 4. Update the global UI State
            setTableInfo({ numRows, numCols, columns });
            setActiveDataType('votable');
            setActiveHdu(null); 
            setFileName(`TAP Query: ${tapUrl.split('/')[2]}`);
            
            setIsOpen(false);

        } catch (error: any) {
            console.error("TAP Query Failed:", error);
            alert(`Query Failed: ${error.message}`);
        } finally {
            setIsFetching(false);
            setIsLoading(false);
        }
    };

    return (
        <>
            {/* The Catalogs Dropdown Menu */}
            <li className="nav-item dropdown">
                <button 
                    className="btn menubar-btn text-start w-100 px-3 py-2 py-md-0" 
                    style={{ fontSize: '0.85rem', height: '36px' }} 
                    data-bs-toggle="dropdown"
                >
                    Catalogs
                </button>
                <ul className="dropdown-menu fv-dropdown-menu shadow position-absolute">
                    <li>
                        <button 
                            className="dropdown-item fv-dropdown-item d-flex align-items-center" 
                            onClick={() => setIsOpen(true)}
                        >
                            <i className="bi bi-cloud-download me-2 fv-text-primary"></i> Advanced TAP Search
                        </button>
                    </li>
                    {/* Placeholder for future catalog tools */}
                    {/* <li><button className="dropdown-item fv-dropdown-item"><i className="bi bi-search me-2"></i> Cone Search</button></li> */}
                </ul>
            </li>

            {/* The ADQL Query Modal */}
            {isOpen && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1050 }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content text-white" style={{ backgroundColor: 'var(--fv-panel)', borderColor: 'var(--fv-border)' }}>
                            <div className="modal-header border-bottom" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                                <h5 className="modal-title" style={{ fontSize: '1rem' }}>
                                    <i className="bi bi-search me-2"></i> Remote TAP Query
                                </h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setIsOpen(false)}></button>
                            </div>
                            <div className="modal-body">
                                <div className="mb-3">
                                    <label className="form-label" style={{ fontSize: '0.85rem', color: 'var(--fv-text-muted)' }}>TAP Service URL</label>
                                    <input 
                                        type="text" 
                                        className="form-control form-control-sm border-secondary" 
                                        style={{ backgroundColor: 'var(--fv-bg)', color: 'var(--fv-text)' }}
                                        value={tapUrl} 
                                        onChange={(e) => setTapUrl(e.target.value)} 
                                    />
                                </div>
                                <div className="mb-3">
                                    <label className="form-label" style={{ fontSize: '0.85rem', color: 'var(--fv-text-muted)' }}>ADQL Query</label>
                                    <textarea 
                                        className="form-control form-control-sm border-secondary font-monospace" 
                                        style={{ backgroundColor: 'var(--fv-bg)', color: 'var(--fv-accent)', fontSize: '0.85rem' }}
                                        rows={4} 
                                        value={query} 
                                        onChange={(e) => setQuery(e.target.value)} 
                                    />
                                </div>
                            </div>
                            <div className="modal-footer border-top-0">
                                <button className="btn btn-sm btn-outline-secondary" onClick={() => setIsOpen(false)}>Cancel</button>
                                <button className="btn btn-sm text-dark fw-bold" style={{ backgroundColor: 'var(--fv-accent)' }} onClick={handleSearch} disabled={isFetching}>
                                    {isFetching ? (
                                        <><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> Querying...</>
                                    ) : (
                                        'Run Query'
                                    )}
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
    // Inject the button directly into the right side of the menus
    pluginManager.registerUI('menubar:menus', <TAPQueryMenu />);
}