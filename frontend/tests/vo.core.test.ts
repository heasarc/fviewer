// frontend/tests/vo.core.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { VOCore } from '../src/workers/vo.core';

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

describe('VOTable Core Logic (Main Thread)', () => {
    let core: VOCore;

    beforeAll(() => {
        core = new VOCore();
    });

    it('should parse an XML string and return table metadata', async () => {
        const result = await core.processCommand('LOAD_VOTABLE_STRING', { xmlString: testVOTableXML });
        
        expect(result.data.metadata.numRows).toBe(2);
        expect(result.data.metadata.colNames).toEqual(['ra', 'dec']);
    });

    it('should read a specific row chunk using Transferables (VirtualTable format)', async () => {
        const result = await core.processCommand('READ_TABLE_CHUNK', { startRow: 0, endRow: 0 });
        
        const columns = Object.keys(result.data);
        expect(columns.length).toBe(2); // ra, dec
        expect(columns).toContain('ra');
        
        // We requested startRow: 0, endRow: 0 (1 row total)
        const raChunk = result.data['ra'];
        expect(raChunk.length).toBe(1);
        expect(raChunk[0]).toBe(10.5); // From our dummy XML
        
        // Ensure it was converted to a TypedArray (Float64Array)
        expect(raChunk instanceof Float64Array).toBe(true);
    });

    it('should read a full column (Plotter format)', async () => {
        const result = await core.processCommand('READ_COLUMN', { colName: 'dec' });
        
        // Plotter expects { data: TypedArray }
        const colData = result.data.data;
        expect(colData.length).toBe(2); // Total rows in dummy XML
        expect(colData[0]).toBe(-5.2); // First dec value
        expect(colData[1]).toBe(-4.8); // Second dec value
    });
});