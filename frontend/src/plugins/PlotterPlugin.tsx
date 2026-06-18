// src/plugins/PlotterPlugin.tsx
import { useState, useEffect, useRef } from 'react';
import { useCore } from '../core/FViewerContext';
import { pluginManager } from '../core/PluginManager';
import { FitsPlot } from '../components/FitsPlot';

// --- 1. The Toggle Button (Goes in the Menubar) ---
const PlotterToggleButton = () => {
    const { isPlotterOpen, setIsPlotterOpen } = useCore();
    return (
        <button 
            className={`btn menubar-btn border-0 px-2 ${isPlotterOpen ? 'fv-text-primary' : 'fv-text-muted'}`} 
            onClick={() => setIsPlotterOpen(!isPlotterOpen)}
            title="Toggle Plotter Sidebar"
        >
            <i className="bi bi-layout-sidebar-reverse fs-5"></i>
        </button>
    );
};

// --- 2. The Main Sidebar (Goes in the Workspace) ---
const PlotterSidebar = () => {
    const { 
        isPlotterOpen, setIsPlotterOpen, activeHdu, activeDataType,
        tableInfo, fitsWorker, voWorker,
            activeRegionPixels, imageData 
    } = useCore();
    
    // Move all the plotter-specific state here!
    const [plotterWidth, setPlotterWidth] = useState(450);
    const [isResizingPlotter, setIsResizingPlotter] = useState(false);
    const [plotX, setPlotX] = useState<string>('');
    const [plotY, setPlotY] = useState<string>('');
    const [plotXErr, setPlotXErr] = useState<string>('');
    const [plotYErr, setPlotYErr] = useState<string>('');
    const [plotType, setPlotType] = useState<'scatter' | 'histogram'>('scatter');
    const [fullPlotData, setFullPlotData] = useState<Record<string, any>>({});
    const fetchedPlotColumns = useRef<Set<string>>(new Set());
    
    const [plotPointSize, setPlotPointSize] = useState<number>(2);
    const [plotPointColor, setPlotPointColor] = useState<string>('#7ec8e3');
    const [plotSubsetMode, setPlotSubsetMode] = useState<'all' | 'range' | 'random'>('all');
    const [plotSubsetStart, setPlotSubsetStart] = useState<number>(0);
    const [plotSubsetEnd, setPlotSubsetEnd] = useState<number>(10000);
    const [plotSubsetRandomN, setPlotSubsetRandomN] = useState<number>(10000);

    const [plotLogX, setPlotLogX] = useState<boolean>(false);
    const [plotLogY, setPlotLogY] = useState<boolean>(false);

    // Fetch full columns ONLY when they are selected AND the plotter is visible
    useEffect(() => {
        // Protect the render: Must have a FITS HDU OR a VOTable
        if ((!activeHdu && activeDataType !== 'votable') || !tableInfo || !isPlotterOpen) return; 

        const columnsToFetch = [plotX, plotY, plotXErr, plotYErr].filter(Boolean);
        
        columnsToFetch.forEach(async (colName) => {
            if (!colName || fetchedPlotColumns.current.has(colName)) return; 
            fetchedPlotColumns.current.add(colName);

            const colIndex = tableInfo.columns.findIndex((c: any) => c.name === colName) + 1;
            if (colIndex > 0) {
                try {
                    // Route to the correct worker!
                    const worker = activeDataType === 'fits' ? fitsWorker : voWorker;
                    // Note: voWorker accepts an optional second argument (colName) 
                    // fitsWorker just ignores it!
                    const result = await worker.readColumn(colIndex, colName);
                    if (result && result.data) {
                        setFullPlotData(prev => ({ ...prev, [colName]: result.data }));
                    }
                } catch (e) {
                    fetchedPlotColumns.current.delete(colName);
                }
            }
        });
    }, [plotX, plotY, plotXErr, plotYErr, activeHdu, activeDataType, 
        tableInfo, fitsWorker, voWorker, isPlotterOpen]);

    // Resize Logic
    useEffect(() => {
        if (!isResizingPlotter) return;
        const handlePointerMove = (e: PointerEvent) => {
            const newWidth = document.body.clientWidth - e.clientX;
            if (newWidth > 300 && newWidth < document.body.clientWidth - 300) setPlotterWidth(newWidth);
        };
        const handlePointerUp = () => setIsResizingPlotter(false);

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [isResizingPlotter]);

    // When tableInfo changes (a new HDU is loaded), reset the default axes!
    useEffect(() => {
        if (tableInfo && tableInfo.numCols >= 2) {
            setPlotX(tableInfo.columns[0].name);
            setPlotY(tableInfo.columns[1].name);
            setPlotXErr('');
            setPlotYErr('');
            setFullPlotData({});
            fetchedPlotColumns.current.clear();
        }
    }, [tableInfo]);

    // Return the actual UI (The resizer handle AND the Sidebar)
    return (
        <>
            {/* The Draggable Resizer */}
            {isPlotterOpen && (
                <div 
                    className="flex-shrink-0"
                    style={{
                        width: '5px', cursor: 'col-resize',
                        backgroundColor: isResizingPlotter ? 'var(--fv-accent)' : 'transparent',
                        borderLeft: '1px solid var(--fv-border)', zIndex: 10
                    }}
                    onPointerDown={(e) => { e.preventDefault(); setIsResizingPlotter(true); }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--fv-panel-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = isResizingPlotter ? 'var(--fv-accent)' : 'transparent'}
                />
            )}

            {/* The Plotter Sidebar */}
            <div 
                className="d-flex flex-column flex-shrink-0" 
                style={{ 
                    width: isPlotterOpen ? `${plotterWidth}px` : '0px', 
                    backgroundColor: 'var(--fv-panel)', 
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
                                        {/* Log X Switch */}
                                        <div className="form-check form-switch mt-2">
                                            <input className="form-check-input" type="checkbox" role="switch" id="logXSwitch" checked={plotLogX} onChange={(e) => setPlotLogX(e.target.checked)} />
                                            <label className="form-check-label text-white" htmlFor="logXSwitch" style={{ fontSize: '0.75rem' }}>Log Scale (X)</label>
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
                                        {/* Log Y Switch */}
                                        <div className="form-check form-switch mt-2">
                                            <input className="form-check-input" type="checkbox" role="switch" id="logYSwitch" checked={plotLogY} onChange={(e) => setPlotLogY(e.target.checked)} disabled={plotType === 'histogram' && plotLogY === false /* optional UX tweak */} />
                                            <label className="form-check-label text-white" htmlFor="logYSwitch" style={{ fontSize: '0.75rem' }}>Log Scale (Y)</label>
                                        </div>
                                    </div>
                                </div>
                                {/* Styling Selectors (Size & Color) */}
                                <div className="row g-2 mb-3">
                                    <div className="col-6">
                                        <div className="input-group input-group-sm shadow-sm">
                                            <span className="input-group-text border-0 bg-dark text-white justify-content-center" style={{ width: '65px' }}>Size</span>
                                            <input 
                                                type="number" 
                                                className="form-control border-0 bg-secondary text-white" 
                                                value={plotPointSize} 
                                                onChange={(e) => setPlotPointSize(Number(e.target.value))} 
                                                min="1" max="10" 
                                                disabled={plotType === 'histogram'}
                                            />
                                        </div>
                                    </div>
                                    <div className="col-6">
                                        <div className="input-group input-group-sm shadow-sm">
                                            <span className="input-group-text border-0 bg-dark text-white justify-content-center" style={{ width: '65px' }}>Color</span>
                                            <input 
                                                type="color" 
                                                className="form-control form-control-color border-0 bg-secondary w-10 px-1 py-1" 
                                                value={plotPointColor} 
                                                onChange={(e) => setPlotPointColor(e.target.value)} 
                                                title="Choose point color" 
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Data Subset Selectors */}
                                <div className="input-group input-group-sm shadow-sm mb-2">
                                    <span className="input-group-text border-0 bg-dark text-white justify-content-center" style={{ width: '65px' }}><i className="bi bi-funnel"></i></span>
                                    <select className="form-select border-0 bg-secondary text-white fw-bold" value={plotSubsetMode} onChange={(e) => setPlotSubsetMode(e.target.value as 'all' | 'range' | 'random')}>
                                        <option value="all">Plot All Rows</option>
                                        <option value="range">Row Range</option>
                                        <option value="random">Random Sample</option>
                                    </select>
                                </div>

                                {plotSubsetMode === 'range' && (
                                    <div className="mb-3 p-2 bg-dark rounded border shadow-sm" style={{ borderColor: 'var(--fv-border)' }}>
                                        
                                        {/* Start Slider + Input */}
                                        <div className="d-flex align-items-center mb-2">
                                            <span className="text-white me-2 fw-bold" style={{ width: '40px', fontSize: '0.75rem' }}>Start</span>
                                            <input 
                                                type="range" 
                                                className="form-range flex-grow-1" 
                                                min="0" 
                                                max={tableInfo.numRows - 1} 
                                                value={plotSubsetStart} 
                                                onChange={(e) => setPlotSubsetStart(Number(e.target.value))} 
                                            />
                                            <input 
                                                type="number" 
                                                className="form-control form-control-sm ms-2 bg-secondary text-white border-0 text-end" 
                                                style={{ width: '80px', fontSize: '0.75rem' }} 
                                                value={plotSubsetStart} 
                                                onChange={(e) => setPlotSubsetStart(Number(e.target.value))} 
                                                min="0"
                                                max={tableInfo.numRows - 1}
                                            />
                                        </div>

                                        {/* End Slider + Input */}
                                        <div className="d-flex align-items-center">
                                            <span className="text-white me-2 fw-bold" style={{ width: '40px', fontSize: '0.75rem' }}>End</span>
                                            <input 
                                                type="range" 
                                                className="form-range flex-grow-1" 
                                                min="0" 
                                                max={tableInfo.numRows - 1} 
                                                value={plotSubsetEnd} 
                                                onChange={(e) => setPlotSubsetEnd(Number(e.target.value))} 
                                            />
                                            <input 
                                                type="number" 
                                                className="form-control form-control-sm ms-2 bg-secondary text-white border-0 text-end" 
                                                style={{ width: '80px', fontSize: '0.75rem' }} 
                                                value={plotSubsetEnd} 
                                                onChange={(e) => setPlotSubsetEnd(Number(e.target.value))} 
                                                min="0"
                                                max={tableInfo.numRows - 1}
                                            />
                                        </div>

                                    </div>
                                )}

                                {plotSubsetMode === 'random' && (
                                    <div className="input-group input-group-sm shadow-sm mb-3">
                                        <span className="input-group-text border-0 bg-dark text-white justify-content-center" style={{ width: '65px' }}>Size</span>
                                        <input type="number" className="form-control border-0 bg-secondary text-white" value={plotSubsetRandomN} onChange={(e) => setPlotSubsetRandomN(Number(e.target.value))} min="1" />
                                    </div>
                                )}
                                
                                <div className="flex-grow-1 bg-dark rounded border d-flex flex-column shadow-sm" style={{ borderColor: 'var(--fv-border)', minHeight: '300px' }}>
                                    {plotX && (plotType === 'histogram' || plotY) && fullPlotData[plotX] ? (
                                        <div className="p-2 w-100 h-100">
                                            <FitsPlot 
                                                xData={fullPlotData[plotX]} 
                                                yData={plotType === 'scatter' && plotY ? fullPlotData[plotY] : undefined} 
                                                xErrData={plotType === 'scatter' && plotXErr ? fullPlotData[plotXErr] : undefined}
                                                yErrData={plotType === 'scatter' && plotYErr ? fullPlotData[plotYErr] : undefined}
                                                xLabel={plotX} 
                                                yLabel={plotType === 'scatter' ? plotY : 'Counts'} 
                                                plotType={plotType}
                                                pointSize={plotPointSize}
                                                pointColor={plotPointColor}
                                                subsetMode={plotSubsetMode}
                                                subsetRange={[plotSubsetStart, plotSubsetEnd]}
                                                subsetRandomN={plotSubsetRandomN}
                                                logX={plotLogX}
                                                logY={plotLogY}
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
        </>
    );
};

// --- 3. Plugin Initialization ---
export function initPlotterPlugin() {
    pluginManager.registerUI('menubar:right', <PlotterToggleButton />);
    pluginManager.registerUI('workspace:right', <PlotterSidebar />);
}