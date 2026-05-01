import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useFits } from './hooks/useFits';
import { useWebSocket, getApiUrl } from './hooks/useWebSocket';
import { useCommandHandler } from './hooks/useCommandHandler';
import { VirtualTable } from './components/VirtualTable';
import { FitsImage } from './components/FitsImage';
import type { Region } from './components/FitsImage';
import { FitsPlot } from './components/FitsPlot';
import { FitsHeaderModal } from './components/FitsHeaderModal';
import { ServerFileModal } from './components/ServerFileModal';
import fviewerLogo from '/fviewer-logo.svg';
import { FITS_FORMATS, ALLOWED_EXTS } from './utils/constants';

function App() {
    // initialize the worker
    const { openFile, moveToHDU, getTableInfo, readColumn, writeCell, saveFile, readImage, getHduList, 
          checkWcs, pixToWorld, readHeader, updateKeyword } = useFits();
    
    
    // File & HDU State
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [fileName, setFileName] = useState("No file loaded");
    const [hduList, setHduList] = useState<any[]>([]);
    const [activeHdu, setActiveHdu] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    // Data State
    const [tableInfo, setTableInfo] = useState<any>(null);
    const [tableData, setTableData] = useState<Record<string, any[]>>({});
    const [imageData, setImageData] = useState<any>(null);
    const [plotX, setPlotX] = useState<string>('');
    const [plotY, setPlotY] = useState<string>('');
    const [isPlotterOpen, setIsPlotterOpen] = useState(false);
    const isPlotterOpenRef = useRef(isPlotterOpen);
    const [plotterWidth, setPlotterWidth] = useState(450); // Default width
    const [isResizingPlotter, setIsResizingPlotter] = useState(false);
    const [plotXErr, setPlotXErr] = useState<string>('');
    const [plotYErr, setPlotYErr] = useState<string>('');
    const [plotType, setPlotType] = useState<'scatter' | 'histogram'>('scatter');
    const [activeRegionPixels, setActiveRegionPixels] = useState<number[] | null>(null);
    
    const [colormap, setColormap] = useState('gray');
    const [stretch, setStretch] = useState('linear');

    const [isHeaderModalOpen, setIsHeaderModalOpen] = useState(false);
    const [rawHeaderString, setRawHeaderString] = useState('');

    const [isServerModalOpen, setIsServerModalOpen] = useState(false);

    const [regions, setRegions] = useState<Region[]>([]);
    const regionInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        await processFile(file);
        
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // handle the logic of opening a file, from upload or from the API
    const processFile = async (file: File) => {
        const fileName = file.name.toLowerCase();
        const isValid = ALLOWED_EXTS.some(ext => fileName.endsWith(ext));
        if (!isValid) {
            alert(`Please select a valid FITS file. Allowed extensions: ${FITS_FORMATS}`);
            return;
        }

        setFileName(file.name);
        setIsLoading(true);
        
        try {
            let buffer: ArrayBuffer;
            
            // Intercept and decompress gzip files natively
            if (file.name.toLowerCase().endsWith('.gz')) {
                const ds = new DecompressionStream('gzip');
                const decompressedStream = file.stream().pipeThrough(ds);
                buffer = await new Response(decompressedStream).arrayBuffer();
            } else {
                buffer = await file.arrayBuffer();
            }
            
            await openFile(new Uint8Array(buffer));
            const list = await getHduList();
            setHduList(list);
            
            const firstValid = list.find((h: any) => h.type !== 'empty');
            setActiveHdu(firstValid ? firstValid.index : 1);
        } catch (error) {
            console.error("Failed to load file:", error);
            alert("Failed to load FITS file.");
        } finally {
            setIsLoading(false);
        }
    };

    // Handle API commands
    const handleRemoteCommand = useCommandHandler(
        processFile,
        colormap, setColormap,
        stretch, setStretch,
        regions, setRegions
    );
    // Listen for commands
    const { clientId, isConnected } = useWebSocket(handleRemoteCommand);

    // Server File listing
    const handleServerFileSelect = async (serverPath: string) => {
        try {
            setIsLoading(true);
            // Fetch the file from the server endpoint we built earlier!
            const response = await fetch(getApiUrl(`/api/file?path=${encodeURIComponent(serverPath)}`));
            if (!response.ok) throw new Error("Failed to fetch file");
            
            const blob = await response.blob();
            const filename = serverPath.split('/').pop() || 'remote.fits';
            const file = new File([blob], filename, { type: 'application/octet-stream' });
            
            // Pass it to your existing file processor
            await processFile(file);
        } catch (error) {
            console.error("Error loading server file:", error);
            alert("Failed to load file from server.");
        } finally {
            setIsLoading(false);
        }
    };

    // keep the plot panel refs in sync
    useEffect(() => {
        isPlotterOpenRef.current = isPlotterOpen;
    }, [isPlotterOpen]);

    useEffect(() => {
        if (!activeHdu) return;

        const loadHduData = async () => {
            setIsLoading(true);
            try {
                const targetHdu = hduList.find(h => h.index === activeHdu);
                await moveToHDU(activeHdu);

                setImageData(null);
                setTableInfo(null);
                setTableData({});

                const headerStr = await readHeader();
                setRawHeaderString(headerStr);

                if (targetHdu?.type === 'image') {
                    const img = await readImage();
                    setImageData(img);
                } 
                else if (targetHdu?.type === 'table') {
                    const info = await getTableInfo();
                    setTableInfo(info);
                    
                    const dataMap: Record<string, any[]> = {};
                    for (let i = 1; i <= info.numCols; i++) {
                        const colResult = await readColumn(i);
                        if (colResult && colResult.data) {
                            dataMap[info.columns[i-1].name] = colResult.data;
                        } else {
                            dataMap[info.columns[i-1].name] = new Array(info.numRows).fill('Unsupported');
                        }
                    }
                    setTableData(dataMap);
                    if (info.numCols >= 2) {
                        setPlotX(info.columns[0].name);
                        setPlotY(info.columns[1].name);
                    }
                }
            } catch (error) {
                console.error("Failed to load HDU data:", error);
            } finally {
                setIsLoading(false);
            }
        };
        loadHduData();
    }, [activeHdu]);

    const handleCellEdit = async (colName: string, colNum: number, rowIndex: number, newValue: string) => {
        try {
            const numericValue = Number(newValue);
            if (isNaN(numericValue)) return alert("Only numeric edits are supported.");
            await writeCell(colNum, rowIndex + 1, numericValue);
            setTableData(prevData => {
                const newData = { ...prevData };
                const newCol = [...newData[colName]];
                newCol[rowIndex] = numericValue;
                newData[colName] = newCol;
                return newData;
            });
        } catch (error) {
            console.error("Failed to write cell:", error);
        }
    };

    const handleSave = async () => {
        try {
            setIsLoading(true);
            const fileBytes = await saveFile();
            const blob = new Blob([fileBytes], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `edited_${fileName}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Failed to save:", error);
        } finally {
            setIsLoading(false);
        }
    };

    // --- PLOTTER RESIZE LOGIC ---
    useEffect(() => {
        if (!isResizingPlotter) return;

        const handlePointerMove = (e: PointerEvent) => {
            // Sidebar is on the right, so its width is (Total Window Width - Mouse X)
            const newWidth = document.body.clientWidth - e.clientX;
            
            // Constrain it so it doesn't crush the main view or disappear entirely
            if (newWidth > 300 && newWidth < document.body.clientWidth - 300) {
                setPlotterWidth(newWidth);
            }
        };

        const handlePointerUp = () => setIsResizingPlotter(false);

        // Attach to window so fast drags don't drop the lock
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);

        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [isResizingPlotter]);

    // --- EXTRACT REGION PIXELS FOR HISTOGRAM ---
    const handleRegionChange = useCallback((region: any | null) => {
        // 1. SHORT CIRCUIT: If no region, no image data, or the plotter is CLOSED, do absolutely nothing!
        if (!region || !imageData || !isPlotterOpenRef.current) {
            setActiveRegionPixels(null);
            return;
        }

        const { data, width, height } = imageData;
        const pixels: number[] = [];
        
        let cx = 0, cy = 0, w = 0, h = 0, radius = 0;
        
        if (region.type === 'box') {
            w = Math.abs(region.endX - region.startX);
            h = Math.abs(region.endY - region.startY);
            cx = (region.startX + region.endX) / 2;
            cy = (region.startY + region.endY) / 2;
        } else if (region.type === 'ellipse') {
            w = Math.abs(region.endX - region.startX) * 2;
            h = Math.abs(region.endY - region.startY) * 2;
            cx = region.startX;
            cy = region.startY;
        } else {
            radius = Math.hypot(region.endX - region.startX, region.endY - region.startY);
            w = radius * 2; h = radius * 2;
            cx = region.startX; cy = region.startY;
        }

        const rad = -(region.angle || 0) * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        const maxR = Math.max(w/2, h/2); 
        const minX = Math.max(1, Math.floor(cx - maxR));
        const maxX = Math.min(width, Math.ceil(cx + maxR));
        const minY = Math.max(1, Math.floor(cy - maxR));
        const maxY = Math.min(height, Math.ceil(cy + maxR));

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                
                const tx = x - cx; const ty = y - cy;
                const rx = tx * cos - ty * sin;
                const ry = tx * sin + ty * cos;

                let inside = false;
                if (region.type === 'box') {
                    if (Math.abs(rx) <= w/2 && Math.abs(ry) <= h/2) inside = true;
                } else if (region.type === 'ellipse') {
                    if ((rx*rx)/Math.pow(w/2, 2) + (ry*ry)/Math.pow(h/2, 2) <= 1) inside = true;
                } else if (region.type === 'annulus') {
                    const r2 = rx*rx + ry*ry;
                    const out2 = Math.pow(radius, 2);
                    const in2 = Math.pow(region.innerR || radius/2, 2);
                    if (r2 <= out2 && r2 >= in2) inside = true;
                } else { 
                    if (rx*rx + ry*ry <= Math.pow(radius, 2)) inside = true;
                }

                if (inside) {
                    const dataIdx = (height - y) * width + (x - 1);
                    pixels.push(data[dataIdx]);
                }
            }
        }
        
        setActiveRegionPixels(pixels);
    }, [imageData]);

    // --- REGION SERIALIZATION (.reg) ---
    const handleSaveRegions = () => {
        if (regions.length === 0) return alert("No regions to save.");
        
        let fileContent = "# Region file format: DS9-style (fviewer)\n";
        fileContent += "global color=#00ff00\n";
        
        regions.forEach(r => {
            let line = "";
            let cx = 0, cy = 0, w = 0, h = 0, radius = 0;

            if (r.type === 'box') {
                w = Math.abs(r.endX - r.startX);
                h = Math.abs(r.endY - r.startY);
                cx = (r.startX + r.endX) / 2;
                cy = (r.startY + r.endY) / 2;
                line = `box(${cx.toFixed(2)},${cy.toFixed(2)},${w.toFixed(2)},${h.toFixed(2)},${r.angle || 0})`;
            } 
            else if (r.type === 'ellipse') {
                w = Math.abs(r.endX - r.startX); // rx
                h = Math.abs(r.endY - r.startY); // ry
                cx = r.startX;
                cy = r.startY;
                line = `ellipse(${cx.toFixed(2)},${cy.toFixed(2)},${w.toFixed(2)},${h.toFixed(2)},${r.angle || 0})`;
            } 
            else { 
                // Circle and Annulus
                radius = Math.hypot(r.endX - r.startX, r.endY - r.startY);
                cx = r.startX;
                cy = r.startY;
                if (r.type === 'annulus') {
                    line = `annulus(${cx.toFixed(2)},${cy.toFixed(2)},${r.innerR?.toFixed(2) || (radius/2).toFixed(2)},${radius.toFixed(2)})`;
                } else {
                    line = `circle(${cx.toFixed(2)},${cy.toFixed(2)},${radius.toFixed(2)})`;
                }
            }
            fileContent += `${line} # color=${r.color}\n`;
        });

        const blob = new Blob([fileContent], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${fileName.replace('.fits', '')}.reg`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const handleLoadRegions = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            const lines = text.split('\n');
            const loadedRegions: Region[] = [];
            
            lines.forEach((line, i) => {
                line = line.trim();
                if (!line || line.startsWith('#') || line.startsWith('global')) return;

                let color = '#00ff00';
                const colorMatch = line.match(/color=([a-zA-Z0-9#]+)/);
                if (colorMatch) color = colorMatch[1];

                const typeMatch = line.match(/^(circle|box|ellipse|annulus)\(([^)]+)\)/);
                if (!typeMatch) return;

                const type = typeMatch[1] as 'circle'|'box'|'ellipse'|'annulus';
                const args = typeMatch[2].split(',').map(Number);
                
                try {
                    let r: Region = { 
                        id: `loaded_${Date.now()}_${i}`, type, 
                        startX: 0, startY: 0, endX: 0, endY: 0, 
                        color, angle: 0 
                    };
                    
                    if (type === 'circle') {
                        r.startX = args[0]; r.startY = args[1];
                        r.endX = args[0] + args[2]; r.endY = args[1]; // Add radius to X to fake the end coordinate
                    } else if (type === 'box') {
                        const cx = args[0], cy = args[1], w = args[2], h = args[3];
                        r.startX = cx - w/2; r.startY = cy - h/2;
                        r.endX = cx + w/2; r.endY = cy + h/2;
                        r.angle = args[4] || 0;
                    } else if (type === 'ellipse') {
                        const cx = args[0], cy = args[1], rx = args[2], ry = args[3];
                        r.startX = cx; r.startY = cy;
                        r.endX = cx + rx; r.endY = cy + ry;
                        r.angle = args[4] || 0;
                    } else if (type === 'annulus') {
                        r.startX = args[0]; r.startY = args[1];
                        r.innerR = args[2];
                        r.endX = args[0] + args[3]; r.endY = args[1]; // outer radius
                    }
                    loadedRegions.push(r);
                } catch (err) {
                    console.warn("Skipped unparseable region line:", line);
                }
            });
            
            setRegions(prev => [...prev, ...loadedRegions]);
        };
        reader.readAsText(file);
        if (regionInputRef.current) regionInputRef.current.value = ''; 
    };

    return (
        // 1. App Layout: Full height, flex column, hide overflow
        <div className="vh-100 d-flex flex-column overflow-hidden" style={{ backgroundColor: 'var(--fv-bg)', color: 'var(--fv-text)' }}>
            
            {/* Hidden File Input */}
            <input type="file" ref={fileInputRef} accept={FITS_FORMATS} style={{ display: 'none' }} onChange={handleFileUpload} />
            <input type="file" ref={regionInputRef} accept=".reg,.txt" style={{ display: 'none' }} onChange={handleLoadRegions} />

            {/* 2. Top Menubar */}
            <nav className="navbar navbar-expand-md navbar-dark flex-shrink-0 border-bottom px-3 py-0" style={{ minHeight: '36px', backgroundColor: '#13151f', borderColor: 'var(--fv-border)' }}>
                <div className="container-fluid p-0">
                    
                    {/* Logo */}
                    <span className="navbar-brand fw-bold d-flex align-items-center gap-2 m-0 p-0" style={{ color: 'var(--fv-accent)', letterSpacing: '1px', fontSize: '1rem' }}>
                        <img 
                            src={fviewerLogo}
                            alt="FViewer Logo" 
                            width="24" 
                            height="24" 
                            style={{ 
                                borderRadius: '8px', 
                                border: '1px solid var(--fv-accent)',
                            }} 
                        /> 
                        FViewer
                    </span>

                    {/* Hamburger Button (Visible only on mobile) */}
                    <button className="navbar-toggler border-0 px-1 py-0" type="button" data-bs-toggle="collapse" data-bs-target="#topMenubar" aria-controls="topMenubar" aria-expanded="false" aria-label="Toggle navigation">
                        <span className="navbar-toggler-icon" style={{ width: '1.2em', height: '1.2em' }}></span>
                    </button>

                    {/* Left-aligned Toggles & Menus */}
                    <div className="collapse navbar-collapse" id="topMenubar">
                        <ul className="navbar-nav me-auto mb-2 mb-md-0 d-flex align-items-md-center">
                            
                            {/* Left Sidebar Toggle Button */}
                            <li className="nav-item">
                                <button 
                                    className={`btn menubar-btn px-3 h-100 ${isSidebarOpen ? 'fv-text-primary' : 'fv-text-muted'}`}
                                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                    title="Toggle HDU Sidebar"
                                >
                                    <i className="bi bi-layout-sidebar"></i>
                                </button>
                            </li>

                            {/* File Menu */}
                            <li className="nav-item dropdown">
                                <button className="btn menubar-btn text-start w-100 px-3 py-2 py-md-0" style={{ fontSize: '0.85rem', height: '36px' }} data-bs-toggle="dropdown">File</button>
                                <ul className="dropdown-menu fv-dropdown-menu shadow position-absolute">
                                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => fileInputRef.current?.click()}><i className="bi bi-folder2-open"></i> Open Local File...</button></li>
                                    {isConnected && (
                                        <li><button className="dropdown-item fv-dropdown-item" onClick={() => setIsServerModalOpen(true)}><i className="bi bi-plug-fill"></i> Open From Server...</button></li>
                                    )}
                                    <li><hr className="dropdown-divider border-secondary my-1" /></li>
                                    <li><button className="dropdown-item fv-dropdown-item" onClick={handleSave} disabled={hduList.length === 0 || isLoading}><i className="bi bi-save"></i> Save Edited FITS</button></li>
                                </ul>
                            </li>

                            {/* Edit Menu */}
                            <li className="nav-item dropdown">
                                <button className="btn menubar-btn text-start w-100 px-3 py-2 py-md-0" style={{ fontSize: '0.85rem', height: '36px' }} data-bs-toggle="dropdown">Edit</button>
                                <ul className="dropdown-menu fv-dropdown-menu shadow position-absolute">
                                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => setIsHeaderModalOpen(true)} disabled={!activeHdu}><i className="bi bi-card-heading"></i> Edit Header</button></li>
                                    <li><button className="dropdown-item fv-dropdown-item"><i className="bi bi-layout-three-columns"></i> Manage Columns</button></li>
                                </ul>
                            </li>

                            {/* View Menu */}
                            <li className="nav-item dropdown">
                                <button className="btn menubar-btn text-start w-100 px-3 py-2 py-md-0" style={{ fontSize: '0.85rem', height: '36px' }} data-bs-toggle="dropdown">View</button>
                                <ul className="dropdown-menu fv-dropdown-menu shadow position-absolute">
                                    <li><button className="dropdown-item fv-dropdown-item"><i className="bi bi-aspect-ratio"></i> Reset View</button></li>
                                </ul>
                            </li>

                            {/* Mobile HDU Menu (Only visible on small screens when Sidebar is hidden) */}
                            {hduList.length > 0 && (
                                <li className="nav-item dropdown d-md-none">
                                    <button className="btn menubar-btn text-start w-100 px-3 py-2 text-info fw-bold" style={{ fontSize: '0.85rem' }} data-bs-toggle="dropdown">
                                        <i className="bi bi-layers"></i> HDUs
                                    </button>
                                    <ul className="dropdown-menu fv-dropdown-menu shadow position-absolute overflow-auto w-100" style={{ maxHeight: '50vh' }}>
                                        {hduList.map((hdu) => (
                                            <li key={hdu.index}>
                                                <button 
                                                    className={`dropdown-item fv-dropdown-item d-flex justify-content-between align-items-center ${activeHdu === hdu.index ? 'fw-bold text-info' : ''} ${hdu.type === 'empty' ? 'text-muted' : ''}`}
                                                    onClick={() => { setActiveHdu(hdu.index); document.getElementById('topMenubar')?.classList.remove('show'); /* Auto-close menu on mobile click */ }}
                                                >
                                                    <span className="text-truncate" style={{ maxWidth: '150px' }}>{hdu.extname}</span>
                                                    <span className="badge border border-secondary text-secondary bg-dark ms-2" style={{ fontSize: '0.6rem' }}>{hdu.type.toUpperCase()}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </li>
                            )}
                        </ul>

                        {/* Right-aligned Status / Filename & Toggles */}
                        <div className="d-flex align-items-center gap-3 ms-3 ms-md-0 pb-2 pb-md-0">
                            {/* API Connection Status */}
                            <div 
                                className="d-none d-md-flex align-items-center" 
                                title={`API Client ID: ${clientId?.split('-')[0]} (${isConnected ? 'Connected' : 'Disconnected'})`}
                            >
                                <i className={`bi ${isConnected ? 'bi-plug-fill fv-text-primary' : 'bi-plug fv-text-muted'}`} style={{ fontSize: '1rem' }}></i>
                            </div>

                            <span className="text-truncate d-none d-sm-block fv-text-muted" style={{ fontSize: '0.8rem', maxWidth: '200px' }}>
                                {fileName}
                            </span>
                            
                            {isLoading && <div className="spinner-border spinner-border-sm fv-text-primary" role="status"></div>}
                            
                            {/* Plotter Toggle Button */}
                            <button 
                                className={`btn menubar-btn border-0 px-2 ${isPlotterOpen ? 'fv-text-primary' : 'fv-text-muted'}`} 
                                onClick={() => {
                                    const willOpen = !isPlotterOpen;
                                    setIsPlotterOpen(willOpen);
                                    // JIT trigger! If we just opened the plotter and an Image region is selected, run the math now!
                                    if (willOpen && imageData && regions.length > 0) {
                                        // Hacky but safe trigger to force the math calculation
                                        setTimeout(() => handleRegionChange(regions[regions.length - 1]), 0);
                                    }
                                }}
                                title="Toggle Plotter Sidebar"
                            >
                                <i className="bi bi-layout-sidebar-reverse fs-5"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            {/* 3. Application Body (Sidebar + Workspace) */}
            <div className="d-flex flex-row flex-grow-1 overflow-hidden">
                
                {/* Collapsible Left Sidebar: HDU List */}
                <div 
                    className="d-none d-md-flex flex-column flex-shrink-0 border-end z-1 shadow-sm" 
                    style={{ 
                        width: isSidebarOpen ? '240px' : '0px', 
                        backgroundColor: 'var(--fv-panel)', 
                        borderColor: 'var(--fv-border)',
                        transition: 'width 0.3s ease-in-out',
                        overflow: 'hidden' // Hides contents when width is 0
                    }}
                >
                    {/* Inner container fixed at 240px to prevent text crushing during slide animation */}
                    <div style={{ width: '240px', minWidth: '240px' }} className="d-flex flex-column h-100 overflow-auto">
                        <div className="p-2 fw-bold text-uppercase border-bottom d-flex align-items-center" style={{ fontSize: '0.75rem', color: 'var(--fv-text-bright)', backgroundColor: 'var(--fv-bg)', borderColor: 'var(--fv-border)', letterSpacing: '0.5px' }}>
                            <i className="bi bi-layers me-2"></i> HDU Explorer
                        </div>
                        
                        {hduList.length === 0 ? (
                            <div className="p-3 fv-text-muted fst-italic" style={{ fontSize: '0.8rem' }}>No file loaded</div>
                        ) : (
                            hduList.map((hdu) => (
                                <button 
                                    key={hdu.index}
                                    className={`w-100 text-start px-3 py-2 d-flex justify-content-between align-items-center border-0 fv-sidebar-item ${activeHdu === hdu.index ? 'active' : ''}`}
                                    onClick={() => setActiveHdu(hdu.index)}
                                >
                                    <span className="text-truncate" style={{ maxWidth: '140px', fontSize: '0.85rem' }} title={hdu.extname}>
                                        {hdu.extname}
                                    </span>
                                    <span className="badge border border-secondary text-secondary bg-dark" style={{ fontSize: '0.65rem', fontWeight: 'normal' }}>
                                        {hdu.type.toUpperCase()}
                                    </span>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Main Content + Right Plotter Sidebar */}
                <div className="d-flex flex-row flex-grow-1 overflow-hidden" style={{ backgroundColor: 'var(--fv-bg)' }}>
                    
                    {/* Center: Image or Table Viewer */}
                    <div className="flex-grow-1 overflow-auto p-3 d-flex flex-column">
                        {activeHdu && (
                            <div className="fade-in d-flex flex-column flex-grow-1 gap-3">
                                
                                {hduList.find(h => h.index === activeHdu)?.type === 'empty' && (
                                    <div className="alert border bg-dark text-white d-flex align-items-center" style={{ borderColor: 'var(--fv-border)' }}>
                                        <i className="bi bi-info-circle me-2"></i> This HDU contains no data (NAXIS=0).
                                    </div>
                                )}

                                {/* Image Viewer */}
                                {imageData && imageData.width > 0 && (
                                    <div className="d-flex justify-content-center w-100 mb-3">
                                        <div 
                                            className="fv-panel-box d-flex flex-column w-100 shadow-sm" 
                                            // Added maxHeight: '70vh' so it shrinks vertically on small screens!
                                            style={{ maxWidth: '800px', height: '650px', maxHeight: '90vh' }} 
                                        >
                                            <div className="fv-panel-header">
                                                <span><i className="bi bi-image me-2"></i> Image Display</span>
                                            </div>
                                            <div className="flex-grow-1 position-relative d-flex flex-column" style={{ minHeight: 0 }}>
                                                <FitsImage 
                                                    data={imageData.data} width={imageData.width} height={imageData.height} 
                                                    checkWcs={checkWcs} pixToWorld={pixToWorld}
                                                    regions={regions}
                                                    setRegions={setRegions}
                                                    onSaveRegions={handleSaveRegions}
                                                    onLoadRegions={() => regionInputRef.current?.click()} 
                                                    onRegionChange={handleRegionChange}
                                                    colormap={colormap}
                                                    setColormap={setColormap}
                                                    stretch={stretch}
                                                    setStretch={setStretch}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Table Viewer */}
                                {tableInfo && (
                                    <div className="fv-panel-box d-flex flex-column flex-grow-1 shadow-sm">
                                        <div className="fv-panel-header">
                                            <span><i className="bi bi-table me-2"></i> Binary Table</span>
                                            <span className="badge bg-secondary">{tableInfo.numRows} Rows | {tableInfo.numCols} Cols</span>
                                        </div>
                                        <div className="flex-grow-1 overflow-hidden" style={{ minHeight: '400px' }}>
                                            <VirtualTable 
                                                numRows={tableInfo.numRows} 
                                                columns={tableInfo.columns} 
                                                dataMap={tableData} 
                                                onCellEdit={handleCellEdit} 
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* --- DRAGGABLE RESIZER HANDLE --- */}
                    {isPlotterOpen && (
                        <div 
                            className="flex-shrink-0"
                            style={{
                                width: '5px',
                                cursor: 'col-resize',
                                backgroundColor: isResizingPlotter ? 'var(--fv-accent)' : 'transparent', // Highlights cyan when grabbed!
                                borderLeft: '1px solid var(--fv-border)',
                                zIndex: 10,
                                transition: 'background-color 0.2s'
                            }}
                            onPointerDown={(e) => {
                                e.preventDefault(); // Prevent text highlighting while dragging
                                setIsResizingPlotter(true);
                            }}
                            // Hover effect
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--fv-panel-hover)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = isResizingPlotter ? 'var(--fv-accent)' : 'transparent'}
                        />
                    )}

                    {/* Right Sidebar: Global Plotter */}
                    <div 
                        className="d-flex flex-column flex-shrink-0" 
                        style={{ 
                            width: isPlotterOpen ? `${plotterWidth}px` : '0px', 
                            maxWidth: '100%', 
                            backgroundColor: 'var(--fv-panel)', 
                            // Disable animation WHILE resizing for instant 60fps response
                            transition: isResizingPlotter ? 'none' : 'width 0.3s ease-in-out',
                            overflow: 'hidden'
                        }}
                    >
                        {/* Inner container uses dynamic plotterWidth to stay rigid during animation */}
                        <div style={{ width: `${plotterWidth}px`, minWidth: `${plotterWidth}px` }} className="d-flex flex-column h-100 p-3">
                            <div className="d-flex align-items-center justify-content-between mb-3 text-white fw-bold border-bottom pb-2" style={{ borderColor: 'var(--fv-border)' }}>
                                <span><i className="bi bi-graph-up me-2 text-primary"></i> Analysis Plotter</span>
                                <button className="btn-close btn-close-white" style={{ fontSize: '0.7rem' }} onClick={() => setIsPlotterOpen(false)}></button>
                            </div>

                            {/* Plot Controls based on active HDU type */}
                            <div className="flex-grow-1 d-flex flex-column">
                                {tableInfo ? (
                                    // TABLE PLOTTING UI
                                    <>
                                        <div className="input-group input-group-sm mb-2 shadow-sm">
                                            <span className="input-group-text border-0 bg-dark text-white"><i className="bi bi-bar-chart"></i></span>
                                            <select className="form-select border-0 bg-secondary text-white fw-bold" value={plotType} onChange={(e) => setPlotType(e.target.value as 'scatter' | 'histogram')}>
                                                <option value="scatter">Scatter Plot</option>
                                                <option value="histogram">1D Histogram</option>
                                            </select>
                                        </div>

                                        {/* Axes Selectors (Perfectly aligned 2x2 Grid) */}
                                        <div className="row g-2 mb-3">
                                            {/* Left Column: X and ErrX */}
                                            <div className="col-6">
                                                <div className="input-group input-group-sm shadow-sm mb-2">
                                                    <span className="input-group-text border-0 bg-dark text-white justify-content-center" style={{ width: '65px' }}>X</span>
                                                    <select className="form-select border-0 bg-secondary text-white" value={plotX} onChange={(e) => setPlotX(e.target.value)}>
                                                        <option value="">-- Select --</option>
                                                        {tableInfo.columns.map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}
                                                    </select>
                                                </div>
                                                <div className="input-group input-group-sm shadow-sm">
                                                    <span className="input-group-text border-0 bg-dark text-white justify-content-center" style={{ width: '65px' }}><i className="bi bi-plus-minus me-1"></i> ErrX</span>
                                                    <select className="form-select border-0 bg-secondary text-white" value={plotXErr} onChange={(e) => setPlotXErr(e.target.value)} disabled={plotType === 'histogram'}>
                                                        <option value="">None</option>
                                                        {plotType !== 'histogram' && tableInfo.columns.map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}
                                                    </select>
                                                </div>
                                            </div>

                                            {/* Right Column: Y and ErrY */}
                                            <div className="col-6">
                                                <div className="input-group input-group-sm shadow-sm mb-2">
                                                    <span className="input-group-text border-0 bg-dark text-white justify-content-center" style={{ width: '65px' }}>Y</span>
                                                    <select className="form-select border-0 bg-secondary text-white" value={plotY} onChange={(e) => setPlotY(e.target.value)} disabled={plotType === 'histogram'}>
                                                        {plotType === 'histogram' ? <option>Counts</option> : (
                                                            <>
                                                                <option value="">-- Select --</option>
                                                                {tableInfo.columns.map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}
                                                            </>
                                                        )}
                                                    </select>
                                                </div>
                                                <div className="input-group input-group-sm shadow-sm">
                                                    <span className="input-group-text border-0 bg-dark text-white justify-content-center" style={{ width: '65px' }}><i className="bi bi-plus-minus me-1"></i> ErrY</span>
                                                    <select className="form-select border-0 bg-secondary text-white" value={plotYErr} onChange={(e) => setPlotYErr(e.target.value)} disabled={plotType === 'histogram'}>
                                                        <option value="">None</option>
                                                        {plotType !== 'histogram' && tableInfo.columns.map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div className="flex-grow-1 bg-dark rounded border d-flex flex-column shadow-sm" style={{ borderColor: 'var(--fv-border)', minHeight: '300px' }}>
                                            {plotX && (plotType === 'histogram' || plotY) && tableData[plotX] ? (
                                                <div className="p-2 w-100 h-100">
                                                    <FitsPlot 
                                                        xData={tableData[plotX]} 
                                                        yData={plotType === 'scatter' && plotY ? tableData[plotY] : undefined} 
                                                        xErrData={plotType === 'scatter' && plotXErr ? tableData[plotXErr] : undefined}
                                                        yErrData={plotType === 'scatter' && plotYErr ? tableData[plotYErr] : undefined}
                                                        xLabel={plotX} 
                                                        yLabel={plotType === 'scatter' ? plotY : 'Counts'} 
                                                        plotType={plotType}
                                                    />
                                                </div>
                                            ) : (
                                                <div className="m-auto text-muted fst-italic">Select columns to plot</div>
                                            )}
                                        </div>
                                    </>
                                ) : imageData ? (
                                    // IMAGE PLOTTING UI
                                    <div className="d-flex flex-column h-100 w-100">
                                        <div className="alert bg-dark text-white border-secondary shadow-sm mb-3" style={{ fontSize: '0.85rem' }}>
                                            <i className="bi bi-info-circle text-primary me-2"></i>
                                            Select a region on the image to view its pixel distribution.
                                        </div>

                                        <div className="flex-grow-1 bg-dark rounded border d-flex flex-column shadow-sm" style={{ borderColor: 'var(--fv-border)', minHeight: '300px' }}>
                                            {activeRegionPixels && activeRegionPixels.length > 0 ? (
                                                <div className="p-2 w-100 h-100">
                                                    <FitsPlot 
                                                        xData={activeRegionPixels} 
                                                        xLabel="Pixel Intensity" 
                                                        plotType="histogram" 
                                                        numBins={50}
                                                        title="Region Histogram"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="m-auto text-center fv-text-muted p-4">
                                                    <i className="bi bi-bounding-box display-4 d-block mb-3 opacity-50"></i>
                                                    <p>No region selected.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="m-auto fv-text-muted fst-italic">No data to plot</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <FitsHeaderModal 
                isOpen={isHeaderModalOpen} 
                onClose={() => setIsHeaderModalOpen(false)} 
                rawHeader={rawHeaderString} 
                onUpdateKeyword={async (key, value, isNum, comment) => {
                    await updateKeyword(key, value, isNum, comment);
                    // Refresh the header display instantly!
                    const newHeader = await readHeader();
                    setRawHeaderString(newHeader);
                }}
            />
            <ServerFileModal 
                isOpen={isServerModalOpen} 
                onClose={() => setIsServerModalOpen(false)} 
                onFileSelect={handleServerFileSelect} 
            />
        </div>
    );
}

export default App;