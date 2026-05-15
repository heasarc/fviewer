// src/core/FViewerContext.tsx
import React, { createContext, useContext, useState } from 'react';
import type {ReactNode} from 'react';
import { useFits } from '../hooks/useFits';

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
}

const FViewerContext = createContext<CoreContextType | null>(null);

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

    const value = {
        fitsWorker,
        fileName, setFileName,
        hduList, setHduList,
        activeHdu, setActiveHdu,
        tableInfo, setTableInfo,
        imageData, setImageData,
        isLoading, setIsLoading,
        isPlotterOpen, setIsPlotterOpen,
        activeRegionPixels, setActiveRegionPixels
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