"use client";

import React from 'react';
import { UploadProgressScreen } from '@/components/create/UploadProgressScreen';

export default function TestUploadProgressPage() {
  return (
    <div>
      <UploadProgressScreen 
        progress={50}
        currentFile={3}
        totalFiles={5}
      />
    </div>
  );
} 