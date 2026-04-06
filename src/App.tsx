import React, { useState } from 'react';
import { useFits } from './hooks/useFits';
import { VirtualTable } from './components/VirtualTable';

function App() {
    const { openFile, moveToHDU, getTableInfo, readColumn } = useFits();
    const [tableInfo, setTableInfo] = useState<any>(null);
    const [tableData, setTableData] = useState<Record<string, any[]>>({});
    const [isLoading, setIsLoading] = useState(false);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsLoading(true);
        const buffer = await file.arrayBuffer();
        
        try {
            const { numHDUs } = await openFile(new Uint8Array(buffer));
            
            if (numHDUs > 1) {
                const { isTable } = await moveToHDU(2);
                if (isTable) {
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
                }
            }
        } catch (error) {
            console.error("Failed to load table:", error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="container-fluid py-4">
            <header className="mb-4 pb-3 border-bottom">
                <h1 className="h3 text-primary">
                    <i className="bi bi-stars"></i> FViewer
                </h1>
                <p className="text-muted mb-0">High-performance FITS Table Viewer</p>
            </header>
            
            <div className="row mb-4">
                <div className="col-md-6">
                    <div className="input-group">
                        <input 
                            type="file" 
                            className="form-control" 
                            accept=".fits,.fit,.fts" 
                            onChange={handleFileUpload} 
                            disabled={isLoading}
                        />
                        {isLoading && (
                            <span className="input-group-text bg-light">
                                <div className="spinner-border spinner-border-sm text-primary" role="status"></div>
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {tableInfo && (
                <div className="card shadow-sm">
                    <div className="card-header bg-light d-flex justify-content-between align-items-center">
                        <h5 className="mb-0">Table Data</h5>
                        <span className="badge bg-secondary">
                            {tableInfo.numRows} Rows | {tableInfo.numCols} Columns
                        </span>
                    </div>
                    <div className="card-body p-0">
                        <VirtualTable 
                            numRows={tableInfo.numRows} 
                            columns={tableInfo.columns} 
                            dataMap={tableData} 
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;