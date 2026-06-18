// frontend/tests/fits.core.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { FitsCore } from '../src/workers/fits.core';
import testFitsUrl from './data/test.fits?url'; 

describe('FITS Core Logic (Main Thread)', () => {
    let core: FitsCore;
    let testFitsData: Uint8Array;

    beforeAll(async () => {
        const response = await fetch(testFitsUrl);
        if (!response.ok) throw new Error("Could not load test.fits");
        
        const arrayBuffer = await response.arrayBuffer();
        testFitsData = new Uint8Array(arrayBuffer);
        
        core = new FitsCore();
    });

    it('should open a real FITS file and initialize WASM', async () => {
        const result = await core.processCommand('OPEN_FILE', testFitsData);
        expect(result.data.numHDUs).toBeGreaterThan(0);
    });

    it('should read a specific row chunk', async () => {
        // Move to HDU 2
        await core.processCommand('MOVE_TO_HDU', { hduNum: 2 });
        
        // Read chunk
        const result = await core.processCommand('READ_TABLE_CHUNK', { 
            startRow: 0, endRow: 1 
        });
        
        const columns = Object.keys(result.data);
        expect(columns.length).toBeGreaterThan(0);
        
        const firstColData = result.data[columns[0]];
        expect(firstColData.length).toBe(2);
    });
});