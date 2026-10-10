import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { FViewerContext } from '../src/core/FViewerContext';
import { pluginManager } from '../src/core/PluginManager';
import { createMockContext } from './utils/PluginTestWrapper';

const wsState = vi.hoisted(() => ({ isConnected: true, clientId: 'abcd-1234' }));
const tableProps = vi.hoisted(() => ({ current: null as any }));

vi.mock('../src/hooks/useWebSocket', () => ({
    useWebSocket: () => wsState,
}));
vi.mock('../src/hooks/useCommandHandler', () => ({ useCommandHandler: () => vi.fn() }));
vi.mock('../src/hooks/useCoreCommands', () => ({ useCoreCommands: vi.fn() }));
vi.mock('../src/components/FitsImage', () => ({
    FitsImage: (p: any) => <div data-testid="fits-image">{p.width}x{p.height}</div>,
}));
vi.mock('../src/components/VirtualTable', () => ({
    VirtualTable: (p: any) => {
        tableProps.current = p;
        return (
            <div data-testid="vtable">
                <button onClick={() => p.onCellEdit('A', 1, 0, '5')}>edit-ok</button>
                <button onClick={() => p.onCellEdit('A', 1, 0, 'abc')}>edit-bad</button>
                <button onClick={() => p.onVectorClick('V', 2, new Float32Array([1, 2]))}>vec</button>
                <button onClick={() => p.onRowClick(3)}>row</button>
                <button onClick={() => p.onFetchData(0, 10)}>fetch</button>
            </div>
        );
    },
}));
vi.mock('../src/components/VectorModal', () => ({
    VectorModal: (p: any) => (
        <div data-testid="vmodal">
            <span>{p.colName}:{p.rowIndex}</span>
            <button onClick={() => p.onEditElement(1, '9')}>vedit</button>
            <button onClick={() => p.onEditElement(1, 'x')}>vedit-bad</button>
            <button onClick={p.onClose}>vclose</button>
        </div>
    ),
}));

import App from '../src/App';

const tableInfo = {
    numRows: 3, numCols: 1,
    columns: [{ name: 'A', unit: '', format: 'E' }],
};

const renderApp = (overrides: any = {}) => {
    const ctx: any = createMockContext(overrides);
    const ui = (c: any) => (
        <FViewerContext.Provider value={c}>
            <App />
        </FViewerContext.Provider>
    );
    const r = render(ui(ctx));
    return { ...r, ctx, rerenderWith: (o: any) => r.rerender(ui({ ...ctx, ...o })) };
};

describe('App', () => {
    let errorSpy: any;
    beforeEach(() => {
        wsState.isConnected = true;
        tableProps.current = null;
        pluginManager['slots'].clear();
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('renders empty state with menus and filename', () => {
        const { ctx } = renderApp({ fileName: 'x.fits' });
        expect(screen.getByText('FViewer')).toBeTruthy();
        expect(screen.getByText('x.fits')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Explore your astronomical data' })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Open a FITS file/ })).toBeTruthy();
        expect(screen.getByText(/drop a supported file here/)).toBeTruthy();
        expect(screen.getByText(/FViewer Version/)).toBeTruthy();
        expect(screen.queryByTestId('fits-image')).toBeNull();
        expect(ctx.setIsConnected).toHaveBeenCalledWith(true);
        expect((screen.getByText(/Save Edited FITS/).closest('button') as HTMLButtonElement).disabled).toBe(true);
    });

    it('opens a dropped file from the empty state', () => {
        const { ctx } = renderApp();
        const dropTarget = screen.getByRole('heading', { name: 'Explore your astronomical data' }).closest('section');
        const file = new File(['data'], 'observation.fits');
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(dropEvent, 'dataTransfer', { value: { files: [file] } });

        fireEvent(dropTarget!, dropEvent);

        expect(ctx.processFile).toHaveBeenCalledWith(file);
    });

    it('shows disconnected state and loading spinner', () => {
        wsState.isConnected = false;
        const { container, ctx } = renderApp({ isLoading: true });
        expect(ctx.setIsConnected).toHaveBeenCalledWith(false);
        expect(container.querySelector('.bi-plug')).toBeTruthy();
        expect(container.querySelector('.spinner-border')).toBeTruthy();
    });

    it('renders plugin slot content', () => {
        pluginManager.registerUI('menubar:right', <span key="p">PLUGIN-X</span>);
        renderApp();
        expect(screen.getByText('PLUGIN-X')).toBeTruthy();
    });

    it('file input triggers processFile and resets', async () => {
        const { ctx, container } = renderApp();
        const input = container.querySelector('input[type=file]') as HTMLInputElement;
        const file = new File(['x'], 'a.fits');
        fireEvent.change(input, { target: { files: [file] } });
        await waitFor(() => expect(ctx.processFile).toHaveBeenCalledWith(file));
        fireEvent.change(input, { target: { files: [] } });
        expect(ctx.processFile).toHaveBeenCalledTimes(1);
    });

    it('Open Local File clicks the hidden input', () => {
        const { container } = renderApp();
        const input = container.querySelector('input[type=file]') as HTMLInputElement;
        const click = vi.spyOn(input, 'click').mockImplementation(() => {});
        fireEvent.click(screen.getByText(/Open Local File/));
        expect(click).toHaveBeenCalled();
    });

    it('resets image display settings from the View menu and omits unavailable column management', () => {
        const { ctx } = renderApp();

        expect(screen.queryByText('Manage Columns')).toBeNull();
        fireEvent.click(screen.getByText('Reset View'));

        expect(ctx.setZoom).toHaveBeenCalledWith(1);
        expect(ctx.setPan).toHaveBeenCalledWith({ x: 0, y: 0 });
        expect(ctx.setFlipX).toHaveBeenCalledWith(false);
        expect(ctx.setFlipY).toHaveBeenCalledWith(false);
        expect(ctx.setRotation).toHaveBeenCalledWith(0);
    });

    it('loads an image HDU (2D)', async () => {
        const img = { data: new Float32Array(4), width: 2, height: 2 };
        const { ctx } = renderApp({
            activeHdu: 1, hduList: [{ index: 1, type: 'image', naxes: [2, 2] }],
        });
        ctx.fitsWorker.readImage.mockResolvedValue(img);
        // effect already ran on mount with initial mocks; wait
        await waitFor(() => expect(ctx.setImageData).toHaveBeenCalledWith(img));
        expect(ctx.fitsWorker.moveToHDU).toHaveBeenCalledWith(1);
        expect(ctx.setCurrentSlice).toHaveBeenCalledWith([]);
        expect(ctx.setIsLoading).toHaveBeenLastCalledWith(false);
    });

    it('toggles between stacked and side-by-side image/catalog layouts', () => {
        renderApp({
            activeDataType: 'votable',
            imageData: { data: new Float32Array(4), width: 2, height: 2 },
            tableInfo,
        });

        const workspace = screen.getByTestId('viewer-workspace');
        expect(workspace.classList.contains('flex-column')).toBe(true);
        expect(screen.getByRole('separator', { name: 'Resize image and catalog panels' }).getAttribute('aria-orientation')).toBe('horizontal');

        fireEvent.click(screen.getByRole('button', { name: 'Switch to side-by-side layout' }));
        expect(workspace.classList.contains('flex-row')).toBe(true);
        expect(screen.getByRole('separator', { name: 'Resize image and catalog panels' }).getAttribute('aria-orientation')).toBe('vertical');

        fireEvent.click(screen.getByRole('button', { name: 'Switch to stacked layout' }));
        expect(workspace.classList.contains('flex-column')).toBe(true);
    });

    it('resizes the table horizontally when dragging the divider in side-by-side layout', () => {
        renderApp({
            activeDataType: 'votable',
            imageData: { data: new Float32Array(4), width: 2, height: 2 },
            tableInfo,
        });
        fireEvent.click(screen.getByRole('button', { name: 'Switch to side-by-side layout' }));

        const separator = screen.getByRole('separator', { name: 'Resize image and catalog panels' });
        const tablePanel = separator.nextElementSibling as HTMLElement;
        const height = tablePanel.style.height;
        expect(tablePanel.style.width).toBe('420px');

        fireEvent.mouseDown(separator);
        expect(document.body.style.cursor).toBe('col-resize');
        act(() => { document.dispatchEvent(new MouseEvent('mousemove', { movementX: 30 })); });
        expect(tablePanel.style.width).not.toBe('420px');
        expect(tablePanel.style.height).toBe(height);
        act(() => { document.dispatchEvent(new MouseEvent('mouseup')); });
        expect(document.body.style.cursor).toBe('');
    });

    it('loads a cube HDU with default slice', async () => {
        const ctx: any = createMockContext({
            activeHdu: 2, hduList: [{ index: 2, type: 'image', naxes: [4, 4, 5, 2] }],
        });
        ctx.fitsWorker.readImage.mockResolvedValue({ data: new Float32Array(1), width: 1, height: 1 });
        render(<FViewerContext.Provider value={ctx}><App /></FViewerContext.Provider>);
        await waitFor(() => expect(ctx.setCurrentSlice).toHaveBeenCalledWith([1, 1]));
        expect(ctx.fitsWorker.readImage).toHaveBeenCalledWith([1, 1]);
    });

    it('loads a table HDU and fetches initial rows', async () => {
        const ctx: any = createMockContext({
            activeHdu: 1, hduList: [{ index: 1, type: 'table' }], tableInfo,
        });
        ctx.fitsWorker.getTableInfo.mockResolvedValue(tableInfo);
        ctx.fitsWorker.readTableChunk.mockResolvedValue({ A: [1, 2, 3] });
        render(<FViewerContext.Provider value={ctx}><App /></FViewerContext.Provider>);
        await waitFor(() => expect(ctx.setTableInfo).toHaveBeenCalledWith(tableInfo));
        await waitFor(() => expect(ctx.fitsWorker.readTableChunk).toHaveBeenCalledWith(0, 3));
        await waitFor(() => expect(tableProps.current.dataMap.A?.[2]).toBe(3));
        expect(screen.getByText(/3 Rows \| 1 Cols/)).toBeTruthy();
    });

    it('logs error when HDU load fails', async () => {
        const ctx: any = createMockContext({
            activeHdu: 1, hduList: [{ index: 1, type: 'image' }],
        });
        ctx.fitsWorker.moveToHDU.mockRejectedValue(new Error('boom'));
        render(<FViewerContext.Provider value={ctx}><App /></FViewerContext.Provider>);
        await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Failed to load HDU data:', expect.any(Error)));
        expect(ctx.setIsLoading).toHaveBeenLastCalledWith(false);
    });

    it('skips HDU loading for votable and uses voWorker for chunks', async () => {
        const ctx: any = createMockContext({
            activeDataType: 'votable', activeHdu: null, hduList: [], tableInfo,
        });
        ctx.voWorker.readTableChunk.mockResolvedValue({ A: [7, 8, 9] });
        render(<FViewerContext.Provider value={ctx}><App /></FViewerContext.Provider>);
        await waitFor(() => expect(ctx.voWorker.readTableChunk).toHaveBeenCalledWith(0, 3));
        expect(ctx.fitsWorker.moveToHDU).not.toHaveBeenCalled();
        expect(tableProps.current.isReadOnly).toBe(true);
        // edits ignored for votable
        fireEvent.click(screen.getByText('edit-ok'));
        expect(ctx.fitsWorker.writeCell).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('vec'));
        fireEvent.click(screen.getByText('vedit'));
        expect(ctx.fitsWorker.writeCell).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('row'));
        expect(ctx.setSelectedCatalogRow).toHaveBeenCalledWith(3);
    });

    it('handles chunk fetch failure', async () => {
        const ctx: any = createMockContext({
            activeHdu: null, activeDataType: 'fits', hduList: [], tableInfo,
        });
        ctx.fitsWorker.readTableChunk.mockRejectedValue(new Error('x'));
        render(<FViewerContext.Provider value={ctx}><App /></FViewerContext.Provider>);
        await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Failed to fetch table chunk:', expect.any(Error)));
    });

    describe('table interactions (fits)', () => {
        const setup = async () => {
            const ctx: any = createMockContext({
                activeHdu: 1, hduList: [{ index: 1, type: 'table' }], tableInfo,
            });
            ctx.fitsWorker.getTableInfo.mockResolvedValue(tableInfo);
            ctx.fitsWorker.readTableChunk.mockResolvedValue({ A: [1, 2, 3] });
            render(<FViewerContext.Provider value={ctx}><App /></FViewerContext.Provider>);
            await waitFor(() => expect(tableProps.current?.dataMap.A?.[0]).toBe(1));
            return ctx;
        };

        it('writes a cell and updates data', async () => {
            const ctx = await setup();
            fireEvent.click(screen.getByText('edit-ok'));
            await waitFor(() => expect(ctx.fitsWorker.writeCell).toHaveBeenCalledWith(1, 1, 5));
            await waitFor(() => expect(tableProps.current.dataMap.A[0]).toBe(5));
        });

        it('rejects non numeric cell edit', async () => {
            const ctx = await setup();
            fireEvent.click(screen.getByText('edit-bad'));
            expect(window.alert).not.toHaveBeenCalled();
            expect(screen.getByText('Only numeric edits are supported.')).toBeInTheDocument();
            expect(ctx.fitsWorker.writeCell).not.toHaveBeenCalled();
        });

        it('logs cell write failure', async () => {
            const ctx = await setup();
            ctx.fitsWorker.writeCell.mockRejectedValue(new Error('w'));
            fireEvent.click(screen.getByText('edit-ok'));
            await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Failed to write cell:', expect.any(Error)));
        });

        it('opens vector modal, edits element, closes', async () => {
            const ctx = await setup();
            fireEvent.click(screen.getByText('vec'));
            expect(screen.getByTestId('vmodal').textContent).toContain('V:2');
            fireEvent.click(screen.getByText('vedit'));
            await waitFor(() => expect(ctx.fitsWorker.writeCell).toHaveBeenCalledWith(0, 3, 9, 1));
            fireEvent.click(screen.getByText('vedit-bad'));
            expect(screen.getByText('Only numeric edits are supported.')).toBeInTheDocument();
            fireEvent.click(screen.getByText('vclose'));
            expect(screen.queryByTestId('vmodal')).toBeNull();
        });

        it('shows inline feedback on vector write failure', async () => {
            const ctx = await setup();
            ctx.fitsWorker.writeCell.mockRejectedValue(new Error('w'));
            fireEvent.click(screen.getByText('vec'));
            fireEvent.click(screen.getByText('vedit'));
            await waitFor(() => expect(screen.getByText('Failed to save edit.')).toBeInTheDocument());
        });

        it('collapses and expands the table drawer', async () => {
            await setup();
            fireEvent.click(screen.getByTitle('Collapse Table'));
            expect(screen.queryByTestId('vtable')).toBeNull();
            fireEvent.click(screen.getByTitle('Expand Table'));
            expect(screen.getByTestId('vtable')).toBeTruthy();
        });
    });

    describe('image + table layout', () => {
        const img = { data: new Float32Array(4), width: 2, height: 2 };
        const mk = () => {
            const ctx: any = createMockContext({
                activeHdu: 1, hduList: [{ index: 1, type: 'table' }], tableInfo, imageData: img,
            });
            ctx.fitsWorker.getTableInfo.mockResolvedValue(tableInfo);
            ctx.fitsWorker.readTableChunk.mockResolvedValue({ A: [1, 2, 3] });
            return ctx;
        };

        it('renders image and resizer, drag resizes, and clear catalog works', async () => {
            const ctx = mk();
            const { container } = render(<FViewerContext.Provider value={ctx}><App /></FViewerContext.Provider>);
            expect(screen.getByTestId('fits-image').textContent).toBe('2x2');
            const resizer = container.querySelector('div[style*="row-resize"]') as HTMLElement;
            expect(resizer).toBeTruthy();
            fireEvent.mouseEnter(resizer);
            fireEvent.mouseLeave(resizer);
            fireEvent.mouseDown(resizer);
            expect(document.body.style.cursor).toBe('row-resize');
            act(() => { document.dispatchEvent(new MouseEvent('mousemove', { movementY: -20 })); });
            act(() => { document.dispatchEvent(new MouseEvent('mouseup')); });
            expect(document.body.style.cursor).toBe('');

            const clear = screen.getByTitle('Close Table and Clear Overlays');
            fireEvent.mouseEnter(clear);
            fireEvent.mouseLeave(clear);
            fireEvent.click(clear);
            expect(ctx.setTableInfo).toHaveBeenCalledWith(null);
            expect(ctx.setSelectedCatalogRow).toHaveBeenCalledWith(null);
            const updater = ctx.setRegions.mock.calls[0][0];
            expect(updater([{ id: 1, isCatalog: true }, { id: 2 }])).toEqual([{ id: 2 }]);
        });
    });

    it('shows messages for empty and groups HDUs', () => {
        renderApp({ activeHdu: 1, hduList: [{ index: 1, type: 'empty' }] });
        expect(screen.getByText(/contains no data/)).toBeTruthy();
        cleanupAndRender('groups');
    });

    function cleanupAndRender(type: string) {
        renderApp({ activeHdu: 2, hduList: [{ index: 2, type }] });
        expect(screen.getByText(/Random Groups HDU/)).toBeTruthy();
    }

    describe('save', () => {
        it('downloads edited file', async () => {
            const bytes = new Uint8Array([1, 2]);
            const url = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
            const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
            const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
            const ctx: any = createMockContext({ fileName: 'f.fits', hduList: [{ index: 1, type: 'empty' }] });
            ctx.fitsWorker.saveFile.mockResolvedValue(bytes);
            render(<FViewerContext.Provider value={ctx}><App /></FViewerContext.Provider>);
            fireEvent.click(screen.getByText(/Save Edited FITS/));
            await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:x'));
            expect(url).toHaveBeenCalled();
            expect(clickSpy).toHaveBeenCalled();
            expect(ctx.setIsLoading).toHaveBeenCalledWith(true);
            expect(ctx.setIsLoading).toHaveBeenLastCalledWith(false);
        });

        it('logs save failure', async () => {
            const ctx: any = createMockContext({ hduList: [{ index: 1, type: 'empty' }] });
            ctx.fitsWorker.saveFile.mockRejectedValue(new Error('s'));
            render(<FViewerContext.Provider value={ctx}><App /></FViewerContext.Provider>);
            fireEvent.click(screen.getByText(/Save Edited FITS/));
            await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Failed to save:', expect.any(Error)));
        });
    });
});
