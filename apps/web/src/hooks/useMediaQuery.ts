"use client"; // Ensure this hook can be used in client components

import { useEffect, useState } from 'react';

export default function useMediaQuery(query: string): boolean {
  // Initialize state with a check, ensuring it runs only client-side
  const [matches, setMatches] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia(query).matches;
    }
    return false; // Default for SSR or if window is not available
  });

  useEffect(() => {
    // Ensure this effect runs only on the client
    if (typeof window === 'undefined') {
      return;
    }

    const mql = window.matchMedia(query);
    const handleChange = () => setMatches(mql.matches);

    // Set initial state again in case it changed between initial render and effect run
    handleChange(); 

    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
} 