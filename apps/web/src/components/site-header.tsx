'use client';

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import { MenuIcon, ArrowRight, Globe } from "lucide-react";
import { useState, useEffect, useRef, useTransition } from "react";
import { useTranslations, useLocale } from 'next-intl';
import { NotificationBell } from "@/components/notification-bell";
import { LANGUAGE_LABELS } from '@storywink/shared/constants';
import { SUPPORTED_LANGUAGES } from '@storywink/shared/schemas';

function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function switchLocale(newLocale: string) {
    if (newLocale === locale) { setIsOpen(false); return; }
    startTransition(async () => {
      await fetch('/api/user/language', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: newLocale }),
      });
      window.location.reload();
    });
  }

  return (
    <div ref={ref} className={`relative ${className || ''}`}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isPending}
        aria-label="Language"
      >
        <Globe className="h-5 w-5" />
      </Button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 bg-white rounded-md shadow-lg border py-1 min-w-[120px] z-50">
          {SUPPORTED_LANGUAGES.map(lang => (
            <button
              key={lang}
              onClick={() => switchLocale(lang)}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 ${lang === locale ? 'font-bold text-[#F76C5E]' : ''}`}
            >
              {LANGUAGE_LABELS[lang] || lang}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SiteHeader() {
  const t = useTranslations('header');
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
    <header className="sticky top-0 z-50 w-full bg-white dark:bg-background/80">
      <div className="w-full flex h-14 items-center px-6 md:px-8 justify-between max-w-none">
        {/* Desktop Logo and Nav */}
        <div className="hidden md:flex items-center">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <Image
              src="https://res.cloudinary.com/storywink/image/upload/v1772291379/Screenshot_2026-02-28_at_10.55.32_PM_copy_xxjms6.png"
              alt={t('mascotAlt')}
              width={160}
              height={80}
              className="h-[62px] w-auto"
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
              alt={t('mascotAlt')}
              width={128}
              height={64}
              className="h-[52px] w-auto"
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
                <LanguageSwitcher />
                <Button asChild variant="ghost">
                  <Link href="/sign-in">{t('signIn')}</Link>
                </Button>
                <Button asChild>
                  <Link href="/sign-up">{t('signUp')}</Link>
                </Button>
             </SignedOut>
             <SignedIn>
                 <Link
                  href="/library"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#F76C5E] text-white rounded-md font-playful text-sm hover:bg-[#e55d4f] transition-all group"
                >
                  {t('toMyStories')}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
                 <NotificationBell />
                 <LanguageSwitcher />
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
              aria-label={t('openMenu')}
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
            <LanguageSwitcher className="self-end" />
            <SignedIn>
              <Link
                href="/library"
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#F76C5E] text-white rounded-md font-playful text-sm hover:bg-[#e55d4f] transition-all group w-fit"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                {t('toMyStories')}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <div className="py-2">
                <UserButton afterSignOutUrl="/" />
              </div>
            </SignedIn>
            <SignedOut>
              <Button asChild variant="ghost" onClick={() => setIsMobileMenuOpen(false)}>
                <Link href="/sign-in">{t('signIn')}</Link>
              </Button>
              <Button asChild onClick={() => setIsMobileMenuOpen(false)}>
                <Link href="/sign-up">{t('signUp')}</Link>
              </Button>
            </SignedOut>
          </nav>
        </div>
      )}
      {/* Cloud/scallop bottom edge — 320px wide tile with 5 varied bumps */}
      <svg
        className="absolute left-0 right-0 pointer-events-none z-30"
        style={{ bottom: '-28px' }}
        width="100%"
        height="28"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id="cloud-scallop"
            x="0"
            y="0"
            width="320"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M0,0 L0,1.5 C2,14 60,13 62,2.5 C65,30 142,28 145,1 C147,18 198,16 200,3 C203,32 272,30 275,1.5 C277,17 318,18 320,1.5 L320,0 Z"
              fill="white"
            />
            <path
              d="M0,1.5 C2,14 60,13 62,2.5 C65,30 142,28 145,1 C147,18 198,16 200,3 C203,32 272,30 275,1.5 C277,17 318,18 320,1.5"
              fill="none"
              stroke="#F76C5E"
              strokeWidth="2.5"
            />
          </pattern>
        </defs>
        <rect width="100%" height="28" fill="url(#cloud-scallop)" />
      </svg>
    </header>
  );
} 