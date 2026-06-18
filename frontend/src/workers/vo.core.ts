// frontend/src/workers/vo.core.ts
import init, { fromXML } from 'votable-wasm'; 
import wasmUrl from 'votable-wasm/vot_bg.wasm?url'; 

export class VOCore {
    activeTableCache: Record<string, any> = {};
    tableMetadata = { numRows: 0, numCols: 0, colNames: [] as string[] };
    isWasmInitialized = false;

    async processCommand(action: string, payload: any): Promise<{ data?: any, transferables?: ArrayBuffer[] }> {
        // 1. Initialize WASM before doing anything else
        if (!this.isWasmInitialized) {
            await init({ module_or_path: wasmUrl }); 
            this.isWasmInitialized = true;
        }

        switch (action) {
            case 'LOAD_VOTABLE_STRING': {
                const parsedVOTable = fromXML(payload.xmlString);
                
                // 1. Iterate safely through ALL resources to find the table
                let tableContainer = null;
                const resources = parsedVOTable.votable.resources || [];
                
                for (const res of resources) {
                    if (res.sub_elems) {
                        tableContainer = res.sub_elems.find(
                            (e: any) => e.resource_or_table?.elem_type === 'Table'
                        );
                        if (tableContainer) break; // Found it!
                    }
                }
                
                // 2. If no table is found, check if the server sent an Error VOTable
                if (!tableContainer) {
                    let errorMsg = "No data TABLE found in the VOTable response.";
                    
                    // Look for <INFO name="QUERY_STATUS" value="ERROR">
                    const allInfos = parsedVOTable.votable.infos || [];
                    const errInfo = allInfos.find((i: any) => i.name === 'QUERY_STATUS' && i.value === 'ERROR');
                    
                    if (errInfo) {
                        errorMsg = `TAP Server Error: ${errInfo.content || 'Unknown Server Error'}`;
                    }
                    throw new Error(errorMsg);
                }
                
                const table = tableContainer.resource_or_table;
                
                // Filter out the Fields from the other table elements
                const fields = table.elems.filter((e: any) => e.elem_type === 'Field');
                
                // Get the rows (TABLEDATA)
                let rows = [];
                if (table.data) {
                    // Try TABLEDATA first, then fallback to BINARY stream
                    rows = table.data.rows || table.data.stream?.rows || [];
                }

                this.tableMetadata.numRows = rows.length;
                this.tableMetadata.numCols = fields.length;
                this.tableMetadata.colNames = fields.map((f: any) => f.name);

                this.activeTableCache = {};
                fields.forEach((field: any, colIdx: number) => {
                    const colName = field.name;
                    // Double/float mapping based on datatype
                    const isNumeric = field.datatype === 'double' || field.datatype === 'float';
                    
                    this.activeTableCache[colName] = isNumeric 
                        ? new Float64Array(rows.length) 
                        : new Array(rows.length);
                    
                    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                        this.activeTableCache[colName][rowIdx] = rows[rowIdx][colIdx];
                    }
                });

                // Clear the parsed array for Garbage Collection
                rows.length = 0;

                return { data: { metadata: this.tableMetadata } };
            }

            // --- CHUNKED ROWS (FOR VIRTUAL TABLE) ---
            case 'READ_TABLE_CHUNK': {
                const { startRow, endRow } = payload;
                const chunkData: Record<string, any> = {};
                const transferables: ArrayBuffer[] = [];

                this.tableMetadata.colNames.forEach((colName) => {
                    const fullCol = this.activeTableCache[colName];
                    if (!fullCol) return;

                    if (ArrayBuffer.isView(fullCol)) {
                        // Slice creates a new underlying ArrayBuffer view
                        const chunk = (fullCol as any).slice(startRow, endRow + 1);
                        chunkData[colName] = chunk;
                        transferables.push(chunk.buffer as ArrayBuffer); // Zero-copy transfer, cast for strict TS
                    } else {
                        // Standard JS Array (strings)
                        chunkData[colName] = fullCol.slice(startRow, endRow + 1);
                    }
                });

                return { data: chunkData, transferables };
            }

            // --- FULL COLUMN (FOR PLOTTER) ---
            case 'READ_COLUMN': {
                // FITS uses colNum (1-indexed), VOTable might be queried by colName or colNum
                const colIndex = payload.colNum !== undefined ? payload.colNum - 1 : -1;
                const name = payload.colName || this.tableMetadata.colNames[colIndex];
                
                if (!name || !this.activeTableCache[name]) {
                    throw new Error(`Column not found`);
                }

                const fullCol = this.activeTableCache[name];
                const transferables: ArrayBuffer[] = [];
                let sendData: any = fullCol;

                if (ArrayBuffer.isView(fullCol)) {
                    // Clone our safe JS cache so we don't lose access to it in the worker
                    const transferClone = (fullCol as any).slice();
                    transferables.push(transferClone.buffer as ArrayBuffer); // Cast for strict TS
                    sendData = transferClone;
                }

                // Mimic the exact { data: ... } wrapping that fits.worker.ts uses
                return { data: { data: sendData }, transferables };
            }
            default:
                throw new Error("Unknown action");
        }
    }
}