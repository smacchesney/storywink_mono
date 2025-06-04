"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BookOpen, LayoutGrid, Palette, Plus, FileText, Check } from 'lucide-react';

export type EditorTab = 'details' | 'cover' | 'pages' | 'artStyle';

interface BottomToolbarProps {
  activeTab: EditorTab;
  onTabChange: (tab: EditorTab) => void;
  onAddPhotoClick: () => void;
  completedSteps: Set<EditorTab>;
}

const tabs: { id: EditorTab; label: string; stepNumber: number; icon: React.ElementType, tourId?: string }[] = [
  { id: 'details', label: 'Details', stepNumber: 1, icon: FileText, tourId: 'details-button' },
  { id: 'cover', label: 'Cover', stepNumber: 2, icon: BookOpen, tourId: 'cover-button' },
  { id: 'pages', label: 'Pages', stepNumber: 3, icon: LayoutGrid, tourId: 'pages-button' },
  { id: 'artStyle', label: 'Art Style', stepNumber: 4, icon: Palette, tourId: 'art-style-button' },
];

export default function BottomToolbar({ 
  activeTab, 
  onTabChange, 
  onAddPhotoClick, 
  completedSteps 
}: BottomToolbarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-lg">
      <div className="px-4 py-3 md:px-6 md:py-4 max-w-6xl mx-auto">
        
        {/* Main Container with step indicators and buttons */}
        <div className="flex items-end space-x-2">
          {/* Main Tab Buttons with Step Indicators */}
          <div className="flex flex-1 space-x-0.5">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const isCompleted = completedSteps.has(tab.id);
              
              return (
                <div key={tab.id} className="flex-1 flex flex-col items-center min-w-0">
                  {/* Step Indicator - centered above button */}
                  <div className="flex items-center justify-center mb-3 md:mb-4">
                    <div className={cn(
                      "flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold transition-all duration-200",
                      isCompleted 
                        ? "bg-green-500 text-white" 
                        : isActive
                        ? "bg-[#F76C5E] text-white"
                        : "bg-gray-200 text-gray-600"
                    )}>
                      {isCompleted ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        tab.stepNumber
                      )}
                    </div>
                  </div>
                  
                  {/* Button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onTabChange(tab.id)}
                    data-tourid={tab.tourId}
                    className={cn(
                      "w-full flex flex-col items-center justify-center min-h-[68px] px-1 py-2 text-xs transition-all duration-200",
                      "rounded-lg border-2 min-w-0",
                      isActive
                        ? "bg-[#F76C5E] hover:bg-[#E55A4C] text-white border-[#F76C5E] shadow-md font-semibold" 
                        : isCompleted
                        ? "bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
                        : "bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200"
                    )}
                  >
                    <Icon className={cn(
                      "w-4 h-4 mb-1 flex-shrink-0",
                      isActive ? "text-white" : isCompleted ? "text-green-600" : "text-gray-600"
                    )} />
                    <span className={cn(
                      "font-medium text-center leading-tight max-w-full text-[10px] sm:text-xs",
                      isActive ? "text-white font-semibold" : isCompleted ? "text-green-700" : "text-gray-600"
                    )}>
                      {tab.label}
                    </span>
                  </Button>
                </div>
              );
            })}
          </div>

          {/* Add Photo Button */}
          <div className="flex flex-col items-center">
            {/* Empty space to align with step indicators */}
            <div className="w-6 h-6 mb-3 md:mb-4" />
            
            <Button
              variant="outline"
              size="sm"
              onClick={onAddPhotoClick}
              className={cn(
                "flex flex-col items-center justify-center min-h-[60px] min-w-[70px] px-2 py-3 text-xs",
                "border-dashed border-2 border-gray-300 hover:border-[#F76C5E] hover:bg-orange-50",
                "transition-all duration-200 rounded-lg bg-white"
              )}
            >
              <Plus className="w-4 h-4 mb-1.5 text-[#F76C5E]" />
              <span className="text-[#F76C5E] font-medium leading-tight">Add</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
} 