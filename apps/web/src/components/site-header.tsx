'use client';

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import { MenuIcon, ArrowRight } from "lucide-react";
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
              src="https://res.cloudinary.com/storywink/image/upload/v1772291379/Screenshot_2026-02-28_at_10.55.32_PM_copy_xxjms6.png"
              alt="Storywink Mascot"
              width={80}
              height={80}
              className="h-20 w-20"
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
              src="https://res.cloudinary.com/storywink/image/upload/v1772291379/Screenshot_2026-02-28_at_10.55.32_PM_copy_xxjms6.png"
              alt="Storywink Mascot"
              width={64}
              height={64}
              className="h-16 w-16"
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
                 <Link
                  href="/library"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#F76C5E] text-white rounded-md font-playful text-sm hover:bg-[#e55d4f] transition-all group"
                >
                  To my stories
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
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
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#F76C5E] text-white rounded-md font-playful text-sm hover:bg-[#e55d4f] transition-all group w-fit"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                To my stories
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
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