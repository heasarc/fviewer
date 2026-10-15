// src/core/FViewerContext.tsx
import React, { createContext, useContext, useState } from 'react';
import type {ReactNode} from 'react';
import { useFits } from '../hooks/useFits';
import { useVOTable } from '../hooks/useVOTable';
import { useRegions } from '../hooks/useRegions';
import type { DrawMode } from '../utils/regionUtils';

// Define the Feedback type so it can be shared
export type FeedbackMessage = {
    type: 'error' | 'success' | 'info';
    message: string;
    retry?: () => void;
};

// Define what our context exposes to the app and plugins
interface CoreContextType {
    fitsWorker: ReturnType<typeof useFits>;
    voWorker: ReturnType<typeof useVOTable>;
    fileName: string;
    setFileName: React.Dispatch<React.SetStateAction<string>>;
    hduList: any[];
    setHduList: React.Dispatch<React.SetStateAction<any[]>>;
    activeHdu: number | null;
    setActiveHdu: React.Dispatch<React.SetStateAction<number | null>>;
    tableInfo: any;
    setTableInfo: React.Dispatch<React.SetStateAction<any>>;
    imageData: any;
    setImageData: React.Dispatch<React.SetStateAction<any>>;
    // multi-dim images
    currentSlice: number[];
    setCurrentSlice: React.Dispatch<React.SetStateAction<number[]>>;
    //
    isLoading: boolean;
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
    isPlotterOpen: boolean;
    setIsPlotterOpen: React.Dispatch<React.SetStateAction<boolean>>;
    activeRegionPixels: number[] | null;
    setActiveRegionPixels: React.Dispatch<React.SetStateAction<number[] | null>>;
    regions: any[];
    setRegions: React.Dispatch<React.SetStateAction<any[]>>;
    processFile: (file: File) => Promise<void>;
    // server
    isConnected: boolean;
    setIsConnected: React.Dispatch<React.SetStateAction<boolean>>;
    serverModalMode: 'fits' | 'region' | null;
    setServerModalMode: React.Dispatch<React.SetStateAction<'fits' | 'region' | null>>;
    // image control
    colormap: string;
    setColormap: React.Dispatch<React.SetStateAction<string>>;
    stretch: string;
    setStretch: React.Dispatch<React.SetStateAction<string>>;
    zoom: number | null;
    setZoom: React.Dispatch<React.SetStateAction<number | null>>;
    pan: { x: number, y: number };
    setPan: React.Dispatch<React.SetStateAction<{ x: number, y: number }>>;
    flipX: boolean;
    setFlipX: React.Dispatch<React.SetStateAction<boolean>>;
    flipY: boolean;
    setFlipY: React.Dispatch<React.SetStateAction<boolean>>;
    rotation: number;
    setRotation: React.Dispatch<React.SetStateAction<number>>;
    // Region control
    drawMode: DrawMode;
    setDrawMode: (mode: any) => void;
    draftRegion: any | null;
    setDraftRegion: (region: any | null) => void;
    selectedRegionId: string | null;
    setSelectedRegionId: (id: string | null) => void;
    hoveredRegionId: string | null;
    setHoveredRegionId: (id: string | null) => void;
    dragAction: any | null;
    setDragAction: (action: any | null) => void;
    deleteSelectedRegion: () => void;
    handleRegionDrag: (x: number, y: number, dx: number, dy: number) => void;
    // left sidebar
    isSidebarOpen: boolean;
    setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
    // table type
    activeDataType: 'fits' | 'votable';
    setActiveDataType: React.Dispatch<React.SetStateAction<'fits' | 'votable'>>;
    selectedCatalogRow: number | null;
    setSelectedCatalogRow: React.Dispatch<React.SetStateAction<number | null>>;

    // Add Feedback state
    feedback: FeedbackMessage | null;
    setFeedback: React.Dispatch<React.SetStateAction<FeedbackMessage | null>>;
}

export const FViewerContext = createContext<CoreContextType | null>(null);

export const FViewerProvider = ({ children }: { children: ReactNode }) => {
    // 1. Initialize the Web Worker
    const fitsWorker = useFits();
    const voWorker = useVOTable();

    // 2. Lift the core state here
    const [activeDataType, setActiveDataType] = useState<'fits' | 'votable'>('fits');
    const [fileName, setFileName] = useState("No file loaded");
    const [hduList, setHduList] = useState<any[]>([]);
    const [activeHdu, setActiveHdu] = useState<number | null>(null);
    const [tableInfo, setTableInfo] = useState<any>(null);
    const [imageData, setImageData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);

    // multi-dim images
    const [currentSlice, setCurrentSlice] = useState<number[]>([]);

    // Plotting
    const [isPlotterOpen, setIsPlotterOpen] = useState(false);
    const [activeRegionPixels, setActiveRegionPixels] = useState<number[] | null>(null);

    // Server
    const [regions, setRegions] = useState<any[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [serverModalMode, setServerModalMode] = useState<'fits' | 'region' | null>(null);

    // Image control
    const [colormap, setColormap] = useState('gray');
    const [stretch, setStretch] = useState('linear');
    const [zoom, setZoom] = useState<number | null>(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [flipX, setFlipX] = useState(false);
    const [flipY, setFlipY] = useState(false);
    const [rotation, setRotation] = useState(0);

    // left sidebar
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    // Catalogs
    const [selectedCatalogRow, setSelectedCatalogRow] = useState<number | null>(null);

    // Initialize the Feedback state here
    const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);

    // More about regions
    const {
        drawMode, setDrawMode,
        draftRegion, setDraftRegion,
        selectedRegionId, setSelectedRegionId,
        hoveredRegionId, setHoveredRegionId,
        dragAction, setDragAction,
        deleteSelectedRegion,
        handleRegionDrag
    } = useRegions(setRegions);

    // handle the logic of opening a file, from upload or from the API
    const processFile = async (file: File) => {
        setIsLoading(true);

        try {
            // --- 1. MAGIC BYTE & GZIP DETECTION ---
            const headerBuffer = await file.slice(0, 2).arrayBuffer();
            const headerBytes = new Uint8Array(headerBuffer);
            const isGzip = headerBytes.length >= 2 && headerBytes[0] === 0x1f && headerBytes[1] === 0x8b;

            let first80Bytes: ArrayBuffer | null = null;

            if (isGzip) {
                // Stream just the first chunk to check the FITS header without decompressing the whole file
                try {
                    const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
                    const reader = stream.getReader();
                    const { value } = await reader.read();
                    if (value) {
                        first80Bytes = value.slice(0, 80).buffer;
                    }
                    await reader.cancel(); // Stop decompressing immediately
                } catch (err) {
                    console.warn("Failed to read gzip stream", err);
                }
            } else {
                // Uncompressed: read the first 80 bytes directly
                first80Bytes = await file.slice(0, 80).arrayBuffer();
            }

            if (!first80Bytes) {
                setFeedback({ type: 'error', message: 'Could not read file contents.' });
                setIsLoading(false);
                return;
            }

            // Decode to string and check for standard FITS signature
            const decoder = new TextDecoder('ascii');
            const headerText = decoder.decode(first80Bytes);
            const isFits = /^SIMPLE\s*=\s*T/.test(headerText);

            if (!isFits) {
                setFeedback({ type: 'error', message: 'The selected file is not a valid FITS file.' });
                setIsLoading(false);
                return;
            }

            setFileName(file.name);
            
            // --- Completely sanitize state before loading a new file ---
            setActiveHdu(null); 
            setActiveDataType('fits'); 
            setImageData(null);
            setTableInfo(null);
            setSelectedCatalogRow(null);
            setRegions([]); 
            // ------------------------------------------------------------
            
            let buffer: ArrayBuffer;

            // Use the magic byte detection instead of file.name to decide how to load it
            if (isGzip) {
                const ds = new DecompressionStream('gzip');
                const decompressedStream = file.stream().pipeThrough(ds);
                buffer = await new Response(decompressedStream).arrayBuffer();
            } else {
                buffer = await file.arrayBuffer();
            }
            
            await fitsWorker.openFile(new Uint8Array(buffer));
            const list = await fitsWorker.getHduList();
            setHduList(list);
            
            const firstValid = list.find((h: any) => h.type !== 'empty');
            setActiveHdu(firstValid ? firstValid.index : 1);
            setFeedback({ type: 'success', message: `Successfully loaded ${file.name}.` });
        } catch (error) {
            console.error("Failed to load file:", error);
            setFeedback({ type: 'error', message: 'Failed to load FITS file.' });
        } finally {
            setIsLoading(false);
        }
    };

    const value = {
        fitsWorker, voWorker,
        activeDataType, setActiveDataType,
        fileName, setFileName,
        hduList, setHduList,
        activeHdu, setActiveHdu,
        tableInfo, setTableInfo,
        imageData, setImageData,
        currentSlice, setCurrentSlice,
        isLoading, setIsLoading,
        isPlotterOpen, setIsPlotterOpen,
        activeRegionPixels, setActiveRegionPixels,
        regions, setRegions,
        isConnected, setIsConnected,
        processFile,
        serverModalMode, setServerModalMode,
        colormap, setColormap,
        stretch, setStretch,
        zoom, setZoom,
        pan, setPan,
        flipX, setFlipX,
        flipY, setFlipY,
        rotation, setRotation,
        drawMode, setDrawMode, draftRegion, setDraftRegion,
        selectedRegionId, setSelectedRegionId, hoveredRegionId, setHoveredRegionId,
        dragAction, setDragAction, deleteSelectedRegion, handleRegionDrag,
        isSidebarOpen, setIsSidebarOpen,
        selectedCatalogRow, setSelectedCatalogRow,
        feedback, setFeedback
    };

    return (
        <FViewerContext.Provider value={value}>
            {children}
        </FViewerContext.Provider>
    );
};

// Custom hook for components and plugins to use
export const useCore = () => {
    const context = useContext(FViewerContext);
    if (!context) {
        throw new Error("useCore must be used within a FViewerProvider");
    }
    return context;
};