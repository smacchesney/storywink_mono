import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Loader2, Pencil, Check, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { coolifyImageUrl } from '@storywink/shared';

interface PageCardProps {
  id: string | undefined;
  imageUrl: string | null;
  text: string | null;
  pageNumber: number;
  isTitlePage: boolean;
  isConfirmed: boolean;
  moderationStatus?: string;
  moderationReason?: string | null;
  isSaving: boolean;
  bookId: string;
  onTextChange: (newText: string) => void;
  onConfirm: () => void;
}

/**
 * PageCard displays a single page with its image and text
 * Provides editing and confirmation functionality
 */
const PageCard = ({
  id: _id,
  imageUrl,
  text,
  pageNumber,
  isTitlePage,
  isConfirmed,
  moderationStatus,
  moderationReason: _moderationReason,
  isSaving,
  bookId: _bookId,
  onTextChange,
  onConfirm
}: PageCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(text || '');
  
  // Update edited text when text prop changes
  useEffect(() => {
    setEditedText(text || '');
  }, [text]);

  const handleSaveText = () => {
    if (editedText.trim().length === 0) {
      toast.error("Text cannot be empty");
      return;
    }
    
    onTextChange(editedText);
    setIsEditing(false);
  };

  return (
    <div className="page-card flex flex-col p-4 bg-white rounded-md shadow-sm">
      {/* Page Label - Centered above image */}
      <div className="text-center mb-3">
        <h3 className="text-sm font-medium text-[#F76C5E]">
          {isTitlePage ? 'Title Page' : `Page ${pageNumber}`}
        </h3>
      </div>

      {/* Image Container */}
      <div className="image-container h-[35vh] relative bg-muted rounded-md mb-4">
        {imageUrl ? (
          <Image
            src={coolifyImageUrl(imageUrl)}
            alt={isTitlePage ? 'Title Page' : `Page ${pageNumber}`}
            fill
            sizes="(max-width: 768px) 100vw, 50vh"
            className="object-contain"
            priority={pageNumber < 3}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-2xl font-semibold text-muted-foreground">
              {isTitlePage ? 'Title Page' : `Page ${pageNumber}`}
            </span>
          </div>
        )}
        
        {/* Moderation Warning */}
        {moderationStatus === 'FLAGGED' && (
          <div className="absolute bottom-2 left-2 bg-amber-100 text-amber-800 px-2 py-1 rounded-md text-xs flex items-center">
            <AlertTriangle className="h-3 w-3 mr-1" />
            <span>Content flagged</span>
          </div>
        )}
      </div>
      
      {/* Action Buttons Row - Edit and Confirm buttons side by side */}
      {!isEditing && (
        <div className="flex gap-2 mb-3">
          <Button 
            variant="ghost" 
            onClick={() => setIsEditing(true)}
            disabled={isSaving || isEditing}
            className="px-3 text-gray-600 hover:bg-gray-100"
          >
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
          <Button
            className={`flex-1 text-white ${
              isConfirmed 
                ? 'bg-green-600 hover:bg-green-700' 
                : 'bg-[#F76C5E] hover:bg-[#F76C5E]/90'
            }`}
            onClick={onConfirm}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : isConfirmed ? (
              <>
                <Check className="h-4 w-4 mr-2" />
                Confirmed
              </>
            ) : (
              "Confirm Text"
            )}
          </Button>
        </div>
      )}
      
      {/* Text Area */}
      <div className="text-editor flex-1">
        {isEditing ? (
          <>
            {isTitlePage ? (
              // Title page input (shorter, larger text)
              <Input
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                className="w-full text-center font-semibold text-lg p-3"
                placeholder="Enter a title for your book..."
              />
            ) : (
              // Regular page textarea
              <Textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                className="w-full min-h-[100px] p-3"
                placeholder={`Enter text for page ${pageNumber}...`}
              />
            )}
            
            {/* Edit mode buttons */}
            <div className="flex gap-2 mt-4">
              <Button 
                variant="outline" 
                onClick={() => {
                  setIsEditing(false);
                  setEditedText(text || "");
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleSaveText}
                className="flex-1 bg-[#F76C5E] hover:bg-[#F76C5E]/90 text-white"
              >
                Save Changes
              </Button>
            </div>
          </>
        ) : isTitlePage ? (
          <div className={`text-content p-3 min-h-[40px] border rounded-md text-center font-semibold text-lg ${
            isConfirmed ? 'bg-green-50 border-green-200' : 'bg-white'
          }`}>
            {text || "Enter a title for your book"}
          </div>
        ) : (
          <div className={`text-content p-3 max-h-[35vh] overflow-y-auto border rounded-md ${
            isConfirmed ? 'bg-green-50 border-green-200' : 'bg-white'
          }`}>
            {text || "No text yet."}
          </div>
        )}
      </div>
    </div>
  );
};

export default PageCard; 