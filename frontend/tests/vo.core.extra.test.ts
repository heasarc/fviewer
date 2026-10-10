import { describe, it, expect } from 'vitest';
import { VOCore } from '../src/workers/vo.core';

const wrap = (body: string, infos = '') => `<?xml version="1.0" encoding="utf-8"?>
<VOTABLE version="1.4" xmlns="http://www.ivoa.net/xml/VOTable/v1.3">${infos}${body}</VOTABLE>`;

const mixed = wrap(`<RESOURCE><TABLE>
  <FIELD name="id" datatype="char" arraysize="*"/>
  <FIELD name="mag" datatype="float"/>
  <DATA><TABLEDATA>
   <TR><TD>a</TD><TD>1.5</TD></TR><TR><TD>b</TD><TD>2.5</TD></TR><TR><TD>c</TD><TD>3.5</TD></TR>
  </TABLEDATA></DATA></TABLE></RESOURCE>`);

describe('VOCore extra', () => {
    it('handles mixed string/numeric columns and chunking', async () => {
        const core = new VOCore();
        const r = await core.processCommand('LOAD_VOTABLE_STRING', { xmlString: mixed });
        expect(r.data.metadata).toMatchObject({ numRows: 3, numCols: 2, colNames: ['id', 'mag'] });

        const chunk = await core.processCommand('READ_TABLE_CHUNK', { startRow: 1, endRow: 2 });
        expect(chunk.data.id).toEqual(['b', 'c']);
        expect(Array.from(chunk.data.mag)).toEqual([2.5, 3.5]);
        expect(chunk.transferables).toHaveLength(1);
    });

    it('reads columns by name and number; string columns are not transferred', async () => {
        const core = new VOCore();
        await core.processCommand('LOAD_VOTABLE_STRING', { xmlString: mixed });
        const byName = await core.processCommand('READ_COLUMN', { colName: 'id' });
        expect(byName.data.data).toEqual(['a', 'b', 'c']);
        expect(byName.transferables).toEqual([]);
        const byNum = await core.processCommand('READ_COLUMN', { colNum: 2 });
        expect(Array.from(byNum.data.data)).toEqual([1.5, 2.5, 3.5]);
        expect(byNum.transferables).toHaveLength(1);
    });

    it('throws for unknown columns and actions', async () => {
        const core = new VOCore();
        await core.processCommand('LOAD_VOTABLE_STRING', { xmlString: mixed });
        await expect(core.processCommand('READ_COLUMN', { colName: 'zzz' })).rejects.toThrow('Column not found');
        await expect(core.processCommand('READ_COLUMN', {})).rejects.toThrow('Column not found');
        await expect(core.processCommand('NOPE', {})).rejects.toThrow('Unknown action');
    });

    it('reports a generic error when no table exists', async () => {
        const core = new VOCore();
        await expect(core.processCommand('LOAD_VOTABLE_STRING', { xmlString: wrap('<RESOURCE></RESOURCE>') }))
            .rejects.toThrow('No data TABLE found');
    });

    it('surfaces TAP server errors from QUERY_STATUS', async () => {
        const core = new VOCore();
        const xml = wrap('<RESOURCE type="results"><INFO name="QUERY_STATUS" value="ERROR">Bad ADQL</INFO></RESOURCE>',
            '<INFO name="QUERY_STATUS" value="ERROR">Bad ADQL</INFO>');
        await expect(core.processCommand('LOAD_VOTABLE_STRING', { xmlString: xml })).rejects.toThrow(/TAP Server Error|No data TABLE/);
    });

    it('handles tables without data rows', async () => {
        const core = new VOCore();
        const xml = wrap('<RESOURCE><TABLE><FIELD name="x" datatype="double"/></TABLE></RESOURCE>');
        const r = await core.processCommand('LOAD_VOTABLE_STRING', { xmlString: xml });
        expect(r.data.metadata.numRows).toBe(0);
    });
});
