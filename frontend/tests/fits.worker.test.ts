import { describe, it, expect, beforeAll } from 'vitest';
import FitsWorker from '../src/fits.worker?worker';

// Vite will resolve this to a local URL served by the test server!
import testFitsUrl from './data/test.fits?url'; 

describe('FITS Web Worker (Browser Environment)', () => {
    let worker: Worker;
    let testFitsData: Uint8Array;

    beforeAll(async () => {
        // 1. Fetch the FITS file from the Vite public directory
        const response = await fetch(testFitsUrl);
        if (!response.ok) throw new Error("Could not load test.fits");
        
        const arrayBuffer = await response.arrayBuffer();
        testFitsData = new Uint8Array(arrayBuffer);
        
        // 2. Instantiate the worker
        worker = new FitsWorker();
    });

    it('should open a real FITS file and initialize WASM', () => {
        return new Promise<void>((resolve, reject) => {
            worker.onmessage = (e) => {
                try {
                    expect(e.data.success).toBe(true);
                    expect(e.data.data.numHDUs).toBeGreaterThan(0);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            };

            worker.postMessage({ 
                id: 'open-test', 
                action: 'OPEN_FILE', 
                payload: testFitsData 
            });
        });
    });

    it('should read a specific row chunk using the C++ readColumn', () => {
        return new Promise<void>((resolve, reject) => {
            worker.onmessage = (e) => {
                // Wait for the move command to succeed
                if (e.data.id === 'move-hdu' && e.data.success) {
                    worker.postMessage({
                        id: 'read-chunk',
                        action: 'READ_TABLE_CHUNK',
                        payload: { startRow: 0, endRow: 1 } // 2 rows
                    });
                }
                
                // Assert on the chunk data
                if (e.data.id === 'read-chunk') {
                    try {
                        expect(e.data.success).toBe(true);
                        
                        const columns = Object.keys(e.data.data);
                        expect(columns.length).toBeGreaterThan(0);
                        
                        const firstColData = e.data.data[columns[0]];
                        expect(firstColData.length).toBe(2); // chunk size!
                        
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                }
            };

            // Assuming HDU 2 is a BINTABLE in your test.fits
            worker.postMessage({ id: 'move-hdu', action: 'MOVE_TO_HDU', payload: { hduNum: 2 } });
        });
    });
});