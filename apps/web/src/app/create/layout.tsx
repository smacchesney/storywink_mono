"use client"; // Layouts using context/state need to be client components

// Import ONLY the provider from the new context file
import { BookCreationProvider } from '@/context/BookCreationContext';
import { UploadFlowProvider } from '@/context/UploadFlowContext';
import { ProgressOverlay } from '@/components/create/ProgressOverlay';

// Layout Component
export default function CreateLayout({ children }: { children: React.ReactNode }) {
  // Wrap all child pages (like /create and /create/review) with the provider
  return (
    <BookCreationProvider>
      <UploadFlowProvider>
        <ProgressOverlay />
        {children}
      </UploadFlowProvider>
    </BookCreationProvider>
  );
} 