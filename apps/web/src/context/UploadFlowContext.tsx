"use client";

import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';

type UploadFlowPhase = 'idle' | 'processing' | 'preparing' | 'loading';

interface UploadFlowState {
  phase: UploadFlowPhase;
  message: string;
  progress?: number;
  currentFile?: number;
  totalFiles?: number;
}

interface UploadFlowContextType {
  state: UploadFlowState;
  startProcessing: (totalFiles?: number) => void;
  updateProgress: (progress: number, currentFile?: number) => void;
  startPreparing: () => void;
  startLoading: () => void;
  finish: () => void;
}

const defaultState: UploadFlowState = {
  phase: 'idle',
  message: '',
};

const UploadFlowContext = createContext<UploadFlowContextType | undefined>(undefined);

export const UploadFlowProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<UploadFlowState>(defaultState);

  const startProcessing = useCallback((totalFiles?: number) => {
    setState({
      phase: 'processing',
      message: 'Processing your photos...',
      progress: 0,
      totalFiles,
      currentFile: 0,
    });
  }, []);

  const updateProgress = useCallback((progress: number, currentFile?: number) => {
    setState(prev => ({
      ...prev,
      progress,
      currentFile,
    }));
  }, []);

  const startPreparing = useCallback(() => {
    setState({
      phase: 'preparing',
      message: 'Getting your book ready...',
    });
  }, []);

  const startLoading = useCallback(() => {
    setState({
      phase: 'loading',
      message: 'Loading your book...',
    });
  }, []);

  const finish = useCallback(() => {
    setState(defaultState);
  }, []);

  return (
    <UploadFlowContext.Provider value={{
      state,
      startProcessing,
      updateProgress,
      startPreparing,
      startLoading,
      finish
    }}>
      {children}
    </UploadFlowContext.Provider>
  );
};

export const useUploadFlow = () => {
  const context = useContext(UploadFlowContext);
  if (!context) {
    throw new Error('useUploadFlow must be used within an UploadFlowProvider');
  }
  return context;
};
