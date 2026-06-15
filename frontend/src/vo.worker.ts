// src/vo.worker.ts
// Import the default export (init) along with fromXML
import init, { fromXML } from 'votable-wasm'; 

import wasmUrl from 'votable-wasm/vot_bg.wasm?url'; 

let activeTableCache: Record<string, any> = {};
let tableMetadata = { numRows: 0, numCols: 0, colNames: [] as string[] };
let isWasmInitialized = false;

// Note: Made the handler async!
self.onmessage = async (e: MessageEvent) => {
    const { id, action, payload } = e.data;

    try {
        // 1. Initialize WASM before doing anything else
        if (!isWasmInitialized) {
            await init({ module_or_path: wasmUrl }); 
            
            isWasmInitialized = true;
        }

        switch (action) {
            case 'LOAD_VOTABLE_STRING': {
                const parsedVOTable = fromXML(payload.xmlString);
                
                // Navigate the correct Serde JSON structure
                const resource = parsedVOTable.votable.resources[0];
                
                // Find the first Table element inside sub_elems
                const tableContainer = resource.sub_elems.find(
                    (e: any) => e.resource_or_table?.elem_type === 'Table'
                );
                
                if (!tableContainer) {
                    throw new Error("No TABLE found in the VOTable resource");
                }
                
                const table = tableContainer.resource_or_table;
                
                // Filter out the Fields from the other table elements
                const fields = table.elems.filter((e: any) => e.elem_type === 'Field');
                
                // Get the rows (TABLEDATA)
                let rows = [];
                if (table.data) {
                    // Try TABLEDATA first, then fallback to BINARY stream
                    rows = table.data.rows || table.data.stream?.rows || [];
                    
                    // DEBUG: If it's still 0, let's print exactly what VizieR sent
                    if (rows.length === 0) {
                        console.log("DEBUG table.data:", table.data);
                    }
                }

                tableMetadata.numRows = rows.length;
                tableMetadata.numCols = fields.length;
                tableMetadata.colNames = fields.map((f: any) => f.name);

                activeTableCache = {};
                fields.forEach((field: any, colIdx: number) => {
                    const colName = field.name;
                    // Double/float mapping based on datatype
                    const isNumeric = field.datatype === 'double' || field.datatype === 'float';
                    
                    activeTableCache[colName] = isNumeric 
                        ? new Float64Array(rows.length) 
                        : new Array(rows.length);
                    
                    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                        activeTableCache[colName][rowIdx] = rows[rowIdx][colIdx];
                    }
                });

                // Clear the parsed array for Garbage Collection
                rows.length = 0;

                self.postMessage({ id, success: true, data: { metadata: tableMetadata } });
                break;
            }
            // --- CHUNKED ROWS (FOR VIRTUAL TABLE) ---
            case 'READ_TABLE_CHUNK': {
                const { startRow, endRow } = payload;
                const chunkData: Record<string, any> = {};
                const transferables: ArrayBuffer[] = [];

                tableMetadata.colNames.forEach((colName) => {
                    const fullCol = activeTableCache[colName];
                    if (!fullCol) return;

                    if (ArrayBuffer.isView(fullCol)) {
                        // Slice creates a new underlying ArrayBuffer view
                        const chunk = (fullCol as any).slice(startRow, endRow + 1);
                        chunkData[colName] = chunk;
                        transferables.push(chunk.buffer); // Zero-copy transfer
                    } else {
                        // Standard JS Array (strings)
                        chunkData[colName] = fullCol.slice(startRow, endRow + 1);
                    }
                });

                (self as any).postMessage({ id, success: true, data: chunkData }, transferables);
                break;
            }

            // --- FULL COLUMN (FOR PLOTTER) ---
            case 'READ_COLUMN': {
                // FITS uses colNum (1-indexed), VOTable might be queried by colName or colNum
                const colIndex = payload.colNum !== undefined ? payload.colNum - 1 : -1;
                const name = payload.colName || tableMetadata.colNames[colIndex];
                
                if (!name || !activeTableCache[name]) {
                    throw new Error(`Column not found`);
                }

                const fullCol = activeTableCache[name];
                const transferables: ArrayBuffer[] = [];
                let sendData: any = fullCol;

                if (ArrayBuffer.isView(fullCol)) {
                    // Clone our safe JS cache so we don't lose access to it in the worker
                    const transferClone = (fullCol as any).slice();
                    transferables.push(transferClone.buffer);
                    sendData = transferClone;
                }

                // Mimic the exact { data: ... } wrapping that fits.worker.ts uses
                (self as any).postMessage({ id, success: true, data: { data: sendData } }, transferables);
                break;
            }
            default:
                self.postMessage({ id, success: false, error: "Unknown action" });
        }
    } catch (error: any) {
        self.postMessage({ id, success: false, error: error.message });
    }
};