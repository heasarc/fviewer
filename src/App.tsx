import React, { useState } from 'react';
import { useFits } from './hooks/useFits';

function App() {
    const { openFile, moveToHDU, getTableInfo, readColumn } = useFits();
    const [tableInfo, setTableInfo] = useState<any>(null);
    const [tableData, setTableData] = useState<Record<string, any[]>>({});

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const buffer = await file.arrayBuffer();
        
        try {
            const { numHDUs } = await openFile(new Uint8Array(buffer));
            
            if (numHDUs > 1) {
                // Move to the first extension (usually a BINTABLE)
                const { isTable } = await moveToHDU(2);
                
                if (isTable) {
                    const info = await getTableInfo();
                    setTableInfo(info);

                    // Fetch data for all columns
                    const dataMap: Record<string, any[]> = {};
                    for (let i = 1; i <= info.numCols; i++) {
                        const colResult = await readColumn(i);
                        // Store just the first 100 rows for our basic DOM test
                        dataMap[info.columns[i-1].name] = Array.from(colResult.data.slice(0, 100));
                    }
                    setTableData(dataMap);
                } else {
                    console.log("HDU 2 is not a table.");
                }
            }
        } catch (error) {
            console.error("Failed to load table:", error);
        }
    };

    return (
        <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
            <h1>FViewer - Table Test</h1>
            <input type="file" accept=".fits" onChange={handleFileUpload} />
            
            {tableInfo && (
                <div style={{ marginTop: '20px' }}>
                    <h3>Table: {tableInfo.numRows} Rows, {tableInfo.numCols} Columns</h3>
                    
                    <table border={1} cellPadding={5} style={{ borderCollapse: 'collapse', marginTop: '10px' }}>
                        <thead>
                            <tr>
                                {tableInfo.columns.map((col: any, idx: number) => (
                                    <th key={idx}>{col.name} <br/><small>({col.unit || 'no unit'})</small></th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {/* Render up to 100 rows */}
                            {Array.from({ length: Math.min(tableInfo.numRows, 100) }).map((_, rowIndex) => (
                                <tr key={rowIndex}>
                                    {tableInfo.columns.map((col: any, colIndex: number) => (
                                        <td key={colIndex}>
                                            {String(tableData[col.name]?.[rowIndex] ?? '...')}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export default App;