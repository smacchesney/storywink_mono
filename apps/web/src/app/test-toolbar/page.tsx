"use client";

import React, { useState } from 'react';
import BottomToolbar, { EditorTab } from '@/components/create/editor/BottomToolbar';

export default function TestToolbarPage() {
  const [activeTab, setActiveTab] = useState<EditorTab>('pages');
  const [completedSteps, setCompletedSteps] = useState<Set<EditorTab>>(new Set(['details', 'cover'] as EditorTab[]));

  const handleTabChange = (tab: EditorTab) => {
    setActiveTab(tab);
  };

  const handlePhotosClick = () => {
    alert('Photos button clicked!');
  };

  const toggleCompletion = (tab: EditorTab) => {
    const newCompleted = new Set(completedSteps);
    if (newCompleted.has(tab)) {
      newCompleted.delete(tab);
    } else {
      newCompleted.add(tab);
    }
    setCompletedSteps(newCompleted);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Mock Header */}
      <div className="bg-white shadow-sm border-b p-4">
        <h1 className="text-xl font-semibold">Simplified Step Indicators</h1>
        <p className="text-sm text-gray-600 mt-1">Testing: Step circles without connector lines</p>
      </div>

      {/* Mock Canvas Area */}
      <div className="flex-1 p-4 pb-32">
        <div className="bg-white rounded-lg border-2 border-dashed border-gray-300 h-[400px] flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-lg font-medium text-gray-600 mb-2">Mock Canvas Area</h2>
            <p className="text-sm text-gray-500">Active Tab: <span className="font-semibold text-[#F76C5E]">{activeTab}</span></p>
            <p className="text-xs text-gray-400 mt-2">Clean step indicators without connecting lines</p>
          </div>
        </div>

        {/* Test Controls */}
        <div className="mt-6 space-y-3">
          <h3 className="font-medium text-gray-800">Test Controls:</h3>
          <div className="flex flex-wrap gap-2">
            {(['details', 'cover', 'pages', 'artStyle'] as EditorTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => toggleCompletion(tab)}
                className="px-3 py-1 text-sm bg-blue-100 hover:bg-blue-200 rounded-md transition-colors"
              >
                Toggle {tab} completion
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {(['details', 'cover', 'pages', 'artStyle'] as EditorTab[]).map((tab) => (
              <button
                key={`activate-${tab}`}
                onClick={() => setActiveTab(tab)}
                className="px-3 py-1 text-sm bg-orange-100 hover:bg-orange-200 rounded-md transition-colors"
              >
                Activate {tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* BottomToolbar */}
      <BottomToolbar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onPhotosClick={handlePhotosClick}
        completedSteps={completedSteps}
      />
    </div>
  );
} 