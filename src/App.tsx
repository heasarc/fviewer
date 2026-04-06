import React, { useState, useEffect } from 'react';
import { useFits } from './hooks/useFits';
import { VirtualTable } from './components/VirtualTable';
import { FitsImage } from './components/FitsImage';
import { FitsPlot } from './components/FitsPlot';

function App() {
    const { openFile, moveToHDU, getTableInfo, readColumn, writeCell, saveFile,
      readImage, getHduList, checkWcs, pixToWorld } = useFits();
    
    // File & HDU State
    const [fileName, setFileName] = useState("edited_file.fits");
    const [hduList, setHduList] = useState<any[]>([]);
    const [activeHdu, setActiveHdu] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Data State
    const [tableInfo, setTableInfo] = useState<any>(null);
    const [tableData, setTableData] = useState<Record<string, any[]>>({});
    const [imageData, setImageData] = useState<any>(null);
    const [plotX, setPlotX] = useState<string>('');
    const [plotY, setPlotY] = useState<string>('');

    // 1. Initial File Upload (Just scans the HDUs)
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setFileName(file.name);
        setIsLoading(true);
        const buffer = await file.arrayBuffer();
        
        try {
            await openFile(new Uint8Array(buffer));
            const list = await getHduList();
            setHduList(list);
            
            // Automatically select the first non-empty HDU
            const firstValid = list.find((h: any) => h.type !== 'empty');
            setActiveHdu(firstValid ? firstValid.index : 1);
        } catch (error) {
            console.error("Failed to load file:", error);
            alert("Failed to load FITS file.");
        } finally {
            setIsLoading(false);
        }
    };

    // 2. Load Data when the Active HDU changes
    useEffect(() => {
        if (!activeHdu) return;

        const loadHduData = async () => {
            setIsLoading(true);
            try {
                const targetHdu = hduList.find(h => h.index === activeHdu);
                await moveToHDU(activeHdu);

                // Clear previous data
                setImageData(null);
                setTableInfo(null);
                setTableData({});

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
    }, [activeHdu]); // Re-run whenever user clicks a new tab

    // Cell Edit & Save Handlers (Keep your existing implementations here)
    const handleCellEdit = async (colName: string, colNum: number, rowIndex: number, newValue: string) => {
        // ... (Keep your existing handleCellEdit code)
    };

    const handleSave = async () => {
        // ... (Keep your existing handleSave code)
    };

    return (
        <div className="container-fluid py-4">
            <header className="mb-4 pb-3 border-bottom d-flex justify-content-between align-items-center">
                <div>
                    <h1 className="h3 text-primary mb-0"><i className="bi bi-stars"></i> FViewer</h1>
                    <p className="text-muted mb-0">High-performance FITS Viewer</p>
                </div>
                {hduList.length > 0 && (
                    <button className="btn btn-primary shadow-sm" onClick={handleSave} disabled={isLoading}>
                        <i className="bi bi-save me-1"></i> Save FITS
                    </button>
                )}
            </header>
            
            <div className="row mb-4">
                <div className="col-md-6">
                    <div className="input-group shadow-sm">
                        <input type="file" className="form-control" accept=".fits,.fit,.fts" onChange={handleFileUpload} disabled={isLoading} />
                        {isLoading && (
                            <span className="input-group-text bg-light">
                                <div className="spinner-border spinner-border-sm text-primary" role="status"></div>
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* HDU Navigation Tabs */}
            {hduList.length > 0 && (
                <ul className="nav nav-tabs mb-4">
                    {hduList.map((hdu) => (
                        <li className="nav-item" key={hdu.index}>
                            <button 
                                className={`nav-link ${activeHdu === hdu.index ? 'active fw-bold' : ''} ${hdu.type === 'empty' ? 'text-muted' : ''}`}
                                onClick={() => setActiveHdu(hdu.index)}
                            >
                                {hdu.extname} <span className="badge bg-secondary ms-1">{hdu.type}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {/* Render Active Data */}
            {activeHdu && (
                <div className="fade-in">
                    {hduList.find(h => h.index === activeHdu)?.type === 'empty' && (
                        <div className="alert alert-secondary">This HDU contains no data (NAXIS=0).</div>
                    )}

                    {imageData && imageData.width > 0 && (
                        <div className="card shadow-sm mb-4">
                            <div className="card-header bg-light"><h5>Image Viewer</h5></div>
                            <div className="card-body bg-secondary d-flex justify-content-center p-3">
                                <FitsImage 
                                  data={imageData.data}
                                  width={imageData.width}
                                  height={imageData.height} 
                                  checkWcs={checkWcs}
                                  pixToWorld={pixToWorld}
                                />
                            </div>
                        </div>
                    )}

                    {tableInfo && (
                        <>
                            {/* Table Component */}
                            <div className="card shadow-sm">
                                <div className="card-header bg-light d-flex justify-content-between align-items-center">
                                    <h5 className="mb-0">Table Data</h5>
                                    <span className="badge bg-secondary">{tableInfo.numRows} Rows | {tableInfo.numCols} Columns</span>
                                </div>
                                <div className="card-body p-0">
                                    <VirtualTable 
                                        numRows={tableInfo.numRows} columns={tableInfo.columns} 
                                        dataMap={tableData} onCellEdit={handleCellEdit}
                                    />
                                </div>
                            </div>

                            {/* Plotter Component */}
                            <div className="card shadow-sm mb-4 border-primary">
                                <div className="card-header bg-primary text-white d-flex align-items-center gap-3">
                                    <h5 className="mb-0"><i className="bi bi-graph-up"></i> Plotter</h5>
                                    <div className="d-flex gap-2 ms-auto">
                                        <div className="input-group input-group-sm">
                                            <span className="input-group-text bg-light">X</span>
                                            <select className="form-select" value={plotX} onChange={(e) => setPlotX(e.target.value)}>
                                                {tableInfo.columns.map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}
                                            </select>
                                        </div>
                                        <div className="input-group input-group-sm">
                                            <span className="input-group-text bg-light">Y</span>
                                            <select className="form-select" value={plotY} onChange={(e) => setPlotY(e.target.value)}>
                                                {tableInfo.columns.map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                <div className="card-body">
                                    {plotX && plotY && tableData[plotX] && tableData[plotY] ? (
                                        <FitsPlot xData={tableData[plotX]} yData={tableData[plotY]} xLabel={plotX} yLabel={plotY} />
                                    ) : (
                                        <p className="text-muted text-center my-4">Select columns to plot</p>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

export default App;