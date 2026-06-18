// tests/vo.worker.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import VOWorker from '../src/vo.worker?worker';

// A minimal valid VOTable XML string for testing
const testVOTableXML = `
<?xml version="1.0" encoding="utf-8"?>
<VOTABLE version="1.4" xmlns="http://www.ivoa.net/xml/VOTable/v1.3">
  <RESOURCE>
    <TABLE>
      <FIELD name="ra" datatype="double" />
      <FIELD name="dec" datatype="double" />
      <DATA>
        <TABLEDATA>
          <TR><TD>10.5</TD><TD>-5.2</TD></TR>
          <TR><TD>11.0</TD><TD>-4.8</TD></TR>
        </TABLEDATA>
      </DATA>
    </TABLE>
  </RESOURCE>
</VOTABLE>
`;

describe('VOTable Web Worker (Browser Environment)', () => {
    let worker: Worker;

    beforeAll(() => {
        worker = new VOWorker();
    });

    it('should parse an XML string and return table metadata', () => {
        return new Promise<void>((resolve, reject) => {
            worker.onmessage = (e) => {
                try {
                    expect(e.data.success).toBe(true);
                    expect(e.data.data.metadata.numRows).toBe(2);
                    expect(e.data.data.metadata.colNames).toEqual(['ra', 'dec']);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            };

            worker.postMessage({ 
                id: 'load-test', 
                action: 'LOAD_VOTABLE_STRING', 
                payload: { xmlString: testVOTableXML } 
            });
        });
    });

    it('should read a specific row chunk using Transferables (VirtualTable format)', () => {
        return new Promise<void>((resolve, reject) => {
            worker.onmessage = (e) => {
                if (e.data.id === 'read-chunk') {
                    try {
                        expect(e.data.success).toBe(true);
                        
                        const columns = Object.keys(e.data.data);
                        expect(columns.length).toBe(2); // ra, dec
                        expect(columns).toContain('ra');
                        
                        // We requested startRow: 0, endRow: 0 (1 row total)
                        const raChunk = e.data.data['ra'];
                        expect(raChunk.length).toBe(1);
                        expect(raChunk[0]).toBe(10.5); // From our dummy XML
                        
                        // Ensure it was converted to a TypedArray (Float64Array)
                        expect(raChunk instanceof Float64Array).toBe(true);
                        
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                }
            };

            worker.postMessage({
                id: 'read-chunk',
                action: 'READ_TABLE_CHUNK',
                payload: { startRow: 0, endRow: 0 } 
            });
        });
    });

    it('should read a full column (Plotter format)', () => {
        return new Promise<void>((resolve, reject) => {
            worker.onmessage = (e) => {
                if (e.data.id === 'read-col') {
                    try {
                        expect(e.data.success).toBe(true);
                        
                        // Plotter expects { data: TypedArray }
                        const colData = e.data.data.data;
                        expect(colData.length).toBe(2); // Total rows in dummy XML
                        expect(colData[0]).toBe(-5.2); // First dec value
                        expect(colData[1]).toBe(-4.8); // Second dec value
                        
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                }
            };

            worker.postMessage({
                id: 'read-col',
                action: 'READ_COLUMN',
                payload: { colName: 'dec' } // We can query by name!
            });
        });
    });
});