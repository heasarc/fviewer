import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { FViewerProvider, useCore } from '../../src/core/FViewerContext';

vi.mock('../../src/hooks/useFits', () => ({
    useFits: vi.fn(() => ({
        openFile: vi.fn().mockResolvedValue(undefined),
        getHduList: vi.fn().mockResolvedValue([{ index: 1, type: 'image' }])
    }))
}));
vi.mock('../../src/hooks/useVOTable', () => ({ useVOTable: vi.fn(() => ({})) }));

const wrapper = ({ children }: { children: React.ReactNode }) => <FViewerProvider>{children}</FViewerProvider>;

describe('FViewerContext gzip', () => {
    it('decompresses .gz files before opening them', async () => {
        const header = new TextEncoder().encode('SIMPLE  =                    T');
        const payload = new Uint8Array([1, 2, 3, 4, 5]);
        const decompressed = new Uint8Array(header.length + payload.length);
        decompressed.set(header, 0);
        decompressed.set(payload, header.length);

        const gz = await new Response(new Blob([decompressed]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
        const file = new File([gz], 'img.fits.gz');

        const { result } = renderHook(() => useCore(), { wrapper });
        const openFile = vi.mocked(result.current.fitsWorker.openFile);

        await act(async () => { await result.current.processFile(file); });

        expect(openFile).toHaveBeenCalledTimes(1);
        expect(new TextDecoder().decode(openFile.mock.calls[0][0] as Uint8Array).startsWith('SIMPLE')).toBe(true);
        expect(result.current.activeHdu).toBe(1);
    });
});
