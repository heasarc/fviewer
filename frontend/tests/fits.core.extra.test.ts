import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { FitsCore } from '../src/workers/fits.core';
import testFitsUrl from './data/test.fits?url';
import testImUrl from './data/test_im.fits?url';

const load = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
const copy = (d: Uint8Array) => d.slice();

describe('FitsCore: error handling without a file', () => {
    const actions = ['READ_HEADER', 'UPDATE_KEYWORD', 'GET_HDU_LIST', 'MOVE_TO_HDU', 'GET_TABLE_INFO',
        'READ_COLUMN', 'READ_TABLE_CHUNK', 'WRITE_CELL', 'SAVE_FILE', 'READ_IMAGE', 'CHECK_WCS',
        'GET_WCS_COUNT', 'SET_ACTIVE_WCS', 'PIX_TO_WORLD', 'WORLD_TO_PIX', 'PIX_SCALE', 'VERIFY_CHECKSUM'];
    it.each(actions)('%s throws when no file is open', async (a) => {
        await expect(new FitsCore().processCommand(a, {})).rejects.toThrow('No file opened');
    });
    it('throws on unknown action', async () => {
        await expect(new FitsCore().processCommand('NOPE', {})).rejects.toThrow('Unknown action');
    });
});

describe('FitsCore: test.fits (tables)', () => {
    let data: Uint8Array;
    let core: FitsCore;
    beforeAll(async () => { data = await load(testFitsUrl); });
    beforeEach(async () => {
        core = new FitsCore();
        await core.processCommand('OPEN_FILE', copy(data));
    });

    it('reopening closes the previous file and resets cache', async () => {
        core.tableCache[1] = {};
        await core.processCommand('OPEN_FILE', copy(data));
        expect(core.tableCache).toEqual({});
    });

    it('lists HDUs with types', async () => {
        const { data: list } = await core.processCommand('GET_HDU_LIST', {});
        expect(list.length).toBeGreaterThan(1);
        expect(list[0].index).toBe(1);
        expect(list.some((h: any) => h.type === 'table')).toBe(true);
        for (const h of list) expect(['image', 'empty', 'table', 'groups', 'unknown']).toContain(h.type);
    });

    it('reads header and moves HDU, flagging tables', async () => {
        expect(await core.processCommand('READ_HEADER', {})).toHaveProperty('data');
        const r = await core.processCommand('MOVE_TO_HDU', { hduNum: 2 });
        expect(r.data.isTable).toBe(true);
        expect(r.data.isImage).toBe(false);
        const p = await core.processCommand('MOVE_TO_HDU', { hduNum: 1 });
        expect(p.data.isImage).toBe(true);
    });

    it('gets table info and reads a full column (cached, transferable clone)', async () => {
        await core.processCommand('MOVE_TO_HDU', { hduNum: 2 });
        const info = (await core.processCommand('GET_TABLE_INFO', {})).data;
        expect(info.numCols).toBe(info.columns.length);
        expect(info.numRows).toBeGreaterThan(0);

        const col = await core.processCommand('READ_COLUMN', { colNum: 1 });
        expect(core.tableCache[1]).toBeDefined();
        const again = await core.processCommand('READ_COLUMN', { colNum: 1 });
        expect(again.data.data.length).toBe(info.numRows);
        if (ArrayBuffer.isView(col.data.data)) {
            expect(col.transferables).toHaveLength(1);
            expect(col.data.data).not.toBe(core.tableCache[1].data);
        }
    });

    it('reads every column in a chunk', async () => {
        await core.processCommand('MOVE_TO_HDU', { hduNum: 2 });
        const info = (await core.processCommand('GET_TABLE_INFO', {})).data;
        const chunk = await core.processCommand('READ_TABLE_CHUNK', { startRow: 1, endRow: Math.min(3, info.numRows) });
        expect(Object.keys(chunk.data)).toEqual(info.columns.map((c: any) => c.name));
        expect(Array.isArray(chunk.transferables)).toBe(true);
    });

    it('writes a cell, invalidates the column cache and saves', async () => {
        await core.processCommand('MOVE_TO_HDU', { hduNum: 2 });
        const info = (await core.processCommand('GET_TABLE_INFO', {})).data;
        const colNum = info.columns.findIndex((c: any) => /^[EDJIK]$/.test(String(c.typechar ?? c.type ?? '')) ) + 1 || 1;
        await core.processCommand('READ_COLUMN', { colNum });
        expect(core.tableCache[colNum]).toBeDefined();
        try {
            await core.processCommand('WRITE_CELL', { colNum, rowNum: 1, value: 1 });
            expect(core.tableCache[colNum]).toBeUndefined();
        } catch (e: any) {
            expect(e.message).toMatch(/Write failed with status/);
        }
        const saved = await core.processCommand('SAVE_FILE', {});
        expect(saved.data.length).toBeGreaterThan(0);
        expect(saved.transferables).toHaveLength(1);
    });

    it('updates string and numeric keywords, and reports failures', async () => {
        await core.processCommand('MOVE_TO_HDU', { hduNum: 1 });
        await core.processCommand('UPDATE_KEYWORD', { key: 'MYSTR', value: 'hello', isNumeric: false, comment: 'c' });
        await core.processCommand('UPDATE_KEYWORD', { key: 'MYNUM', value: '3.5', isNumeric: true });
        const hdr = JSON.stringify((await core.processCommand('READ_HEADER', {})).data);
        expect(hdr).toContain('MYSTR');
        expect(hdr).toContain('MYNUM');
        vi.spyOn(core.activeFile!, 'updateKeyString').mockReturnValue(1);
        await expect(core.processCommand('UPDATE_KEYWORD', { key: 'BAD', value: 'x', isNumeric: false }))
            .rejects.toThrow(/Failed to update keyword BAD/);
    });

    it('validates checksum arguments', async () => {
        await expect(core.processCommand('VERIFY_CHECKSUM', {})).rejects.toThrow('valid HDU number');
        await expect(core.processCommand('VERIFY_CHECKSUM', { hduNum: 0 })).rejects.toThrow('valid HDU number');
        await expect(core.processCommand('VERIFY_CHECKSUM', { hduNum: 99 })).rejects.toThrow(/Failed to move to HDU 99/);
    });
});

describe('FitsCore: test_im.fits (images, WCS)', () => {
    let data: Uint8Array;
    let core: FitsCore;
    beforeAll(async () => { data = await load(testImUrl); });
    beforeEach(async () => {
        core = new FitsCore();
        await core.processCommand('OPEN_FILE', copy(data));
    });

    it('reads the image with dimensions and physical transform defaults', async () => {
        const hdus = (await core.processCommand('GET_HDU_LIST', {})).data;
        const img = hdus.find((h: any) => h.type === 'image');
        expect(img).toBeDefined();
        expect(img.naxes.length).toBeGreaterThan(0);
        await core.processCommand('MOVE_TO_HDU', { hduNum: img.index });
        const r = await core.processCommand('READ_IMAGE', {});
        expect(r.data.width).toBe(img.naxes[0]);
        expect(r.data.height).toBe(img.naxes[1]);
        expect(r.data).toHaveProperty('ltm1_1');
        expect(r.transferables!.length).toBe(1);
    });

    it('answers WCS queries without throwing', async () => {
        await core.processCommand('MOVE_TO_HDU', { hduNum: 1 });
        const has = (await core.processCommand('CHECK_WCS', {})).data;
        expect(typeof has).toBe('boolean');
        await core.processCommand('GET_WCS_COUNT', {});
        await core.processCommand('PIX_SCALE', {});
        await core.processCommand('PIX_TO_WORLD', { x: 1, y: 1 });
        await core.processCommand('WORLD_TO_PIX', { ra: 10, dec: 10 });
        await expect(core.processCommand('SET_ACTIVE_WCS', { index: 9999 })).rejects.toThrow('Invalid WCS index');
    });
});
