// frontend/tests/fits.core.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { FitsCore } from '../src/workers/fits.core';
import testFitsUrl from './data/test.fits?url';
import testBitpix64Url from './data/test_bitpix64.fits?url';
import testBitpixNeg64Url from './data/test_bitpix_neg64.fits?url';
import testHierarchUrl from './data/test_hierarch.fits?url';
import testLongstringUrl from './data/test_longstring.fits?url';

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

async function loadFixture(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load fixture: ${url}`);
    return new Uint8Array(await response.arrayBuffer());
}

describe('BITPIX=64 (int64) images', () => {
    let core: FitsCore;

    beforeAll(async () => {
        core = new FitsCore();
        const data = await loadFixture(testBitpix64Url);
        await core.processCommand('OPEN_FILE', data);
    });

    it('should open and read the image', async () => {
        const result = await core.processCommand('READ_IMAGE', {});
        expect(result.data).toBeTruthy();
        expect(result.data.width).toBe(10);
        expect(result.data.height).toBe(10);
    });

    it('should return BigInt64Array data', async () => {
        const result = await core.processCommand('READ_IMAGE', {});
        expect(result.data.data).toBeInstanceOf(BigInt64Array);
    });
});

describe('BITPIX=-64 (float64) images', () => {
    let core: FitsCore;

    beforeAll(async () => {
        core = new FitsCore();
        const data = await loadFixture(testBitpixNeg64Url);
        await core.processCommand('OPEN_FILE', data);
    });

    it('should open and read the image', async () => {
        const result = await core.processCommand('READ_IMAGE', {});
        expect(result.data).toBeTruthy();
        expect(result.data.width).toBe(10);
        expect(result.data.height).toBe(10);
    });

    it('should return Float64Array data', async () => {
        const result = await core.processCommand('READ_IMAGE', {});
        expect(result.data.data).toBeInstanceOf(Float64Array);
    });
});

describe('HIERARCH keywords', () => {
    let core: FitsCore;
    let rawHeader: string;

    beforeAll(async () => {
        core = new FitsCore();
        const data = await loadFixture(testHierarchUrl);
        await core.processCommand('OPEN_FILE', data);
        const result = await core.processCommand('READ_HEADER');
        rawHeader = result;
    });

    it('should contain HIERARCH keywords in the raw header', () => {
        expect(rawHeader).toContain('HIERARCH');
        expect(rawHeader).toContain('ESO OBS PROG ID');
    });
});

describe('Long string CONTINUE convention', () => {
    let core: FitsCore;
    let rawHeader: string;

    beforeAll(async () => {
        core = new FitsCore();
        const data = await loadFixture(testLongstringUrl);
        await core.processCommand('OPEN_FILE', data);
        const result = await core.processCommand('READ_HEADER');
        rawHeader = result;
    });

    it('should contain CONTINUE cards in the raw header', () => {
        expect(rawHeader).toContain('CONTINUE');
    });

    it('should contain the LONGSTRN keyword', () => {
        expect(rawHeader).toContain('LONGSTRN');
    });
});