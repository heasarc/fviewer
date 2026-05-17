// src/core/FViewerContext.tsx
import React, { createContext, useContext, useState } from 'react';
import type {ReactNode} from 'react';
import { useFits } from '../hooks/useFits';
import { useRegions } from '../hooks/useRegions';
import type { DrawMode } from '../utils/regionUtils';
import { FITS_FORMATS, ALLOWED_EXTS } from '../utils/constants';

// Define what our context exposes to the app and plugins
interface CoreContextType {
    fitsWorker: ReturnType<typeof useFits>;
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

}

export const FViewerContext = createContext<CoreContextType | null>(null);

export const FViewerProvider = ({ children }: { children: ReactNode }) => {
    // 1. Initialize the Web Worker
    const fitsWorker = useFits();

    // 2. Lift the core state here
    const [fileName, setFileName] = useState("No file loaded");
    const [hduList, setHduList] = useState<any[]>([]);
    const [activeHdu, setActiveHdu] = useState<number | null>(null);
    const [tableInfo, setTableInfo] = useState<any>(null);
    const [imageData, setImageData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);

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
        // You might need to import ALLOWED_EXTS and FITS_FORMATS at the top of this file!
        const fileName = file.name.toLowerCase();
        const isValid = ALLOWED_EXTS.some(ext => fileName.endsWith(ext));
        if (!isValid) {
            alert(`Please select a valid FITS file. Allowed extensions: ${FITS_FORMATS}`);
            return;
        }

        setFileName(file.name);
        setIsLoading(true);
        setActiveHdu(null); // Force UI wipe
        
        try {
            let buffer: ArrayBuffer;

            // Intercept and decompress gzip files natively
            if (file.name.toLowerCase().endsWith('.gz')) {
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
        } catch (error) {
            console.error("Failed to load file:", error);
            alert("Failed to load FITS file.");
        } finally {
            setIsLoading(false);
        }
    };

    const value = {
        fitsWorker,
        fileName, setFileName,
        hduList, setHduList,
        activeHdu, setActiveHdu,
        tableInfo, setTableInfo,
        imageData, setImageData,
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