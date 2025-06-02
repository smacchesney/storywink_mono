"use client"; // Layouts using context/state need to be client components

import { ReactNode } from 'react';
// Import ONLY the provider from the new context file
import { BookCreationProvider } from '@/context/BookCreationContext';

// Layout Component
export default function CreateLayout({ children }: { children: React.ReactNode }) {
  // Wrap all child pages (like /create and /create/review) with the provider
  return (
    <BookCreationProvider>
      {children}
    </BookCreationProvider>
  );
} 