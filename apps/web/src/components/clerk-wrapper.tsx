'use client';

import React from 'react';
import { useAuth } from '@clerk/nextjs';

interface ClerkWrapperProps {
  children: (auth: {
    isLoaded: boolean;
    isSignedIn: boolean | undefined;
    getToken: (() => Promise<string | null>) | (() => Promise<null>);
  }) => React.ReactNode;
  fallback?: React.ReactNode;
}

export function ClerkWrapper({ children, fallback }: ClerkWrapperProps) {
  const hasClerkKey = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  
  if (!hasClerkKey) {
    // Provide fallback auth state when Clerk is not available
    return (
      <>
        {children({
          isLoaded: true,
          isSignedIn: false,
          getToken: async () => null,
        })}
        {fallback}
      </>
    );
  }
  
  // Use actual Clerk when available
  const auth = useAuth();
  return <>{children(auth)}</>;
}