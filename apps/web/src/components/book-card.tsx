"use client"; // Add this directive

import React from 'react';
import Image from 'next/image';
import { BookStatus, Page } from '@prisma/client'; // Import BookStatus and Page
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal, Trash2, Copy, Pencil, Eye, Loader2, BookOpen, Clock, CheckCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

// Define the props for BookCard, ensuring all needed fields are present
// We might need to adjust this if LibraryBook from actions.ts has a different structure
export interface BookCardProps {
  id: string;
  title: string | null; // Allow null titles
  status: BookStatus;
  updatedAt?: Date | null; // Make updatedAt optional
  pages?: Page[]; // Make pages optional
  coverImageUrl?: string | null; // Allow null cover image
  onDeleteClick: () => void;
  onDuplicateClick: () => void;
  isDeleting?: boolean;
  isDuplicating?: boolean;
}

// Helper function to get status badge variant (can be moved to utils if used elsewhere)
const getStatusVariant = (status: BookStatus): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case BookStatus.COMPLETED:
      return 'default';
    case BookStatus.ILLUSTRATING:
    case BookStatus.GENERATING:
      return 'secondary';
    case BookStatus.STORY_READY:
      return 'default'; // Story ready - positive state
    case BookStatus.FAILED:
      return 'destructive';
    case BookStatus.DRAFT:
    default:
      return 'outline';
  }
};

// Helper function to get status icon
const getStatusIcon = (status: BookStatus) => {
  switch (status) {
    case BookStatus.COMPLETED:
      return <CheckCircle className="h-4 w-4 mr-1.5" />;
    case BookStatus.ILLUSTRATING:
    case BookStatus.GENERATING:
      return <Clock className="h-4 w-4 mr-1.5" />;
    case BookStatus.STORY_READY:
      return <CheckCircle className="h-4 w-4 mr-1.5" />; // Story complete - checkmark
    case BookStatus.DRAFT:
    default:
      return <BookOpen className="h-4 w-4 mr-1.5" />;
  }
};

const BookCard: React.FC<BookCardProps> = ({
  id,
  title,
  updatedAt,
  status,
  pages: _pages,
  coverImageUrl,
  onDeleteClick,
  onDuplicateClick,
  isDeleting = false,
  isDuplicating = false,
}) => {
  const router = useRouter();

  const handleEditClick = () => {
    // Navigate to the correct editor step based on book status
    switch (status) {
      case BookStatus.DRAFT:
        router.push(`/create/${id}/edit`);
        break;
      case BookStatus.GENERATING: // Text generation in progress
      case BookStatus.STORY_READY: // Story ready for review
      case BookStatus.ILLUSTRATING: // Illustration generation in progress
      case BookStatus.PARTIAL: // Some illustrations failed or were flagged
      case BookStatus.FAILED: // Text or illustration generation failed
        router.push(`/create/review?bookId=${id}`);
        break;
      // For COMPLETED status, the "View" button is shown instead of "Edit",
      // so no explicit case is needed here for navigation.
      // If an "Edit" button were to be shown for COMPLETED books for some reason,
      // it would likely go to /create/[bookId]/edit or a specific "post-completion editor".
      default:
        // Fallback to the main editor page if status is unknown or not handled above
        router.push(`/create/${id}/edit`);
        break;
    }
  };
  
  const handleViewClick = () => {
    // Navigate to book preview
    router.push(`/book/${id}/preview`);
  };

  const isCompleted = status === BookStatus.COMPLETED;
  const isProcessing = status === BookStatus.GENERATING || status === BookStatus.ILLUSTRATING;

  // Determine the image URL to display based on the coverImageUrl prop
  // The logic to select between original/generated based on status is now handled in library/actions.ts
  const displayImageUrl = coverImageUrl;

  // Mobile-friendly card layout for all devices
  return (
    <Card className="flex flex-col hover:shadow-md transition-shadow overflow-hidden">
      <div className="flex flex-row sm:flex-col">
        {/* Image thumbnail - larger on mobile, takes left side */}
        <div className="relative w-28 h-28 sm:w-full sm:h-auto sm:aspect-video flex-shrink-0 sm:rounded-none bg-muted overflow-hidden">
          {displayImageUrl ? (
            <Image
              src={displayImageUrl}
              alt={`${title || 'Book'} cover`}
              fill
              sizes="(max-width: 640px) 112px, (max-width: 1024px) 45vw, 25vw"
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-xs text-muted-foreground">No Preview</span>
            </div>
          )}
        </div>
        
        {/* Content on the right side for mobile, underneath for desktop */}
        <div className="flex flex-col flex-grow p-3 sm:p-0">
          <CardHeader className="p-3 sm:pb-2 sm:pt-4 flex-shrink-0">
            <CardTitle className="text-base sm:text-lg truncate">{title || 'Untitled Book'}</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Last updated: {updatedAt ? new Date(updatedAt).toLocaleDateString() : 'N/A'}
            </CardDescription>
          </CardHeader>
          
          <CardContent className="hidden sm:flex flex-col p-3 pt-0 flex-grow">
            {/* Status badge displayed on desktop at the bottom of content */}
            <div className="mt-auto">
              <Badge 
                variant={getStatusVariant(status)}
                className={cn(
                  "inline-flex items-center",
                  status === BookStatus.COMPLETED && "bg-[#F76C5E]"
                )}
              >
                {getStatusIcon(status)}
                {status}
              </Badge>
            </div>
          </CardContent>
          
          {/* Mobile-only status badge */}
          <div className="sm:hidden px-3 pb-2">
            <Badge 
              variant={getStatusVariant(status)}
              className={cn(
                "inline-flex items-center text-xs",
                status === BookStatus.COMPLETED && "bg-[#F76C5E]"
              )}
            >
              {getStatusIcon(status)}
              {status}
            </Badge>
          </div>
          
          {/* Primary actions for mobile - larger touch targets */}
          <div className="flex mt-auto p-3 pt-0 sm:hidden">
            {isCompleted ? (
              <Button 
                onClick={handleViewClick} 
                size="sm" 
                className="mr-2 flex-grow"
                style={{ backgroundColor: '#F76C5E' }}
              >
                <Eye className="h-4 w-4 mr-1.5" />
                View
              </Button>
            ) : (
              <Button 
                onClick={handleEditClick} 
                size="sm" 
                className="mr-2 flex-grow"
                disabled={isProcessing}
                style={!isProcessing ? { backgroundColor: '#F76C5E' } : {}}
              >
                <Pencil className="h-4 w-4 mr-1.5" />
                Edit
              </Button>
            )}
            
            {/* More actions dropdown - mobile */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={isDeleting || isDuplicating}>
                  {isDeleting || isDuplicating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MoreHorizontal className="h-4 w-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onDuplicateClick} disabled={isDuplicating}>
                  <Copy className="mr-2 h-4 w-4" /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive focus:bg-destructive/10" onClick={onDeleteClick} disabled={isDeleting}>
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
            
      {/* Desktop-only footer with actions */}
      <CardFooter className="hidden sm:flex justify-between items-center pt-2 px-4 pb-3 flex-shrink-0">
        {isCompleted ? (
          <Button 
            onClick={handleViewClick} 
            size="sm" 
            style={{ backgroundColor: '#F76C5E' }}
            className="flex-grow mr-2"
          >
            <Eye className="h-4 w-4 mr-1.5" />
            View Preview
          </Button>
        ) : (
          <Button 
            onClick={handleEditClick} 
            size="sm"
            style={!isProcessing ? { backgroundColor: '#F76C5E' } : {}}
            className="flex-grow mr-2"
            disabled={isProcessing}
          >
            <Pencil className="h-4 w-4 mr-1.5" />
            Edit
          </Button>
        )}
        
        {/* Dropdown menu for secondary actions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" disabled={isDeleting || isDuplicating}>
              {isDeleting || isDuplicating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreHorizontal className="h-4 w-4" />
              )}
              <span className="sr-only">Book Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDuplicateClick} disabled={isDuplicating}>
              <Copy className="mr-2 h-4 w-4" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive focus:bg-destructive/10" onClick={onDeleteClick} disabled={isDeleting}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  );
};

export default BookCard; 