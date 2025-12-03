'use client';

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import { MenuIcon } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { NotificationBell } from "@/components/notification-bell";

export function SiteHeader() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isMobileMenuOpen &&
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(event.target as Node) &&
        menuButtonRef.current &&
        !menuButtonRef.current.contains(event.target as Node)
      ) {
        setIsMobileMenuOpen(false);
      }
    };

    if (isMobileMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMobileMenuOpen]);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#B8E4DC]/30 bg-[rgba(184,228,220,0.35)] dark:bg-background/80 backdrop-blur-md">
      <div className="w-full flex h-14 items-center px-6 md:px-8 justify-between max-w-none">
        {/* Desktop Logo and Nav */}
        <div className="hidden md:flex items-center">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <Image
              src="/images/mascot/dino waving_nobg.png"
              alt="Storywink Mascot"
              width={40}
              height={40}
              className="h-10 w-10"
            />
            <span className="hidden font-bold text-3xl sm:inline-block text-slate-900 dark:text-white font-playful">
              Storywin<span className="text-[#F76C5E]">k.ai</span>
            </span>
          </Link>
        </div>

        {/* Mobile Logo */}
        <div className="flex items-center md:hidden">
          <Link href="/" className="flex items-center space-x-2">
            <Image
              src="/images/mascot/dino waving_nobg.png"
              alt="Storywink Mascot"
              width={32}
              height={32}
              className="h-8 w-8"
            />
            <span className="font-bold text-2xl sm:inline-block text-slate-900 dark:text-white font-playful">
              Storywin<span className="text-[#F76C5E]">k.ai</span>
            </span>
          </Link>
        </div>
        
        {/* Right side content (Auth buttons and Mobile Menu Trigger) - Absolutely positioned to far right */}
        <div className="flex items-center space-x-3 ml-auto">
          {/* Auth buttons - visible on desktop screens */}
          <div className="hidden md:flex items-center space-x-3">
             <SignedOut>
                <Button asChild variant="ghost">
                  <Link href="/sign-in">Sign In</Link>
                </Button>
                <Button asChild>
                  <Link href="/sign-up">Sign Up</Link>
                </Button>
             </SignedOut>
             <SignedIn>
                 <Button asChild variant="secondary" size="sm">
                    <Link
                      href="/library"
                      className="text-slate-900 dark:text-white transition-colors hover:text-slate-700 dark:hover:text-slate-300"
                    >
                      My Library
                    </Link>
                 </Button>
                 <NotificationBell />
                 <div className="flex items-center ml-2">
                   <UserButton afterSignOutUrl="/" />
                 </div>
             </SignedIn>
          </div>

          {/* Mobile: Notification Bell + Menu Trigger */}
          <div className="flex items-center md:hidden">
            <SignedIn>
              <NotificationBell />
            </SignedIn>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open menu"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              ref={menuButtonRef}
            >
              <MenuIcon className="h-6 w-6" />
            </Button>
          </div>
        </div>
      </div>
      {/* Mobile Menu (dropdown) */}
      {isMobileMenuOpen && (
        <div
          ref={mobileMenuRef}
          className="absolute top-14 left-0 right-0 z-40 bg-white dark:bg-background shadow-md md:hidden"
        >
          <nav className="container flex flex-col space-y-2 p-4">
            <SignedIn>
              <Link
                href="/library"
                className="text-slate-900 dark:text-white transition-colors hover:text-slate-700 dark:hover:text-slate-300 py-2"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                My Library
              </Link>
              <div className="py-2">
                <UserButton afterSignOutUrl="/" />
              </div>
            </SignedIn>
            <SignedOut>
              <Button asChild variant="ghost" onClick={() => setIsMobileMenuOpen(false)}>
                <Link href="/sign-in">Sign In</Link>
              </Button>
              <Button asChild onClick={() => setIsMobileMenuOpen(false)}>
                <Link href="/sign-up">Sign Up</Link>
              </Button>
            </SignedOut>
          </nav>
        </div>
      )}
    </header>
  );
} 