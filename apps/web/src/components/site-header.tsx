'use client';

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import { MenuIcon, ArrowRight, Globe, Package, Users } from "lucide-react";
import { useState, useEffect, useRef, useTransition } from "react";
import { useTranslations, useLocale } from 'next-intl';
import { NotificationBell } from "@/components/notification-bell";
import { ScallopEdge } from "@/components/ui/scallop-edge";
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
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-coral-soft ${lang === locale ? 'font-bold text-coral' : ''}`}
            >
              {LANGUAGE_LABELS[lang] || lang}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Clerk user menu: "My characters" (flag-gated) + "My orders" — the quiet
 *  homes for the character shelf and print orders. */
function UserMenu() {
  const t = useTranslations('orders');
  const th = useTranslations('header');
  const avatarsEnabled = process.env.NEXT_PUBLIC_AVATARS_ENABLED === 'true';
  return (
    <UserButton afterSignOutUrl="/">
      <UserButton.MenuItems>
        {avatarsEnabled && (
          <UserButton.Link
            label={th('myCharacters')}
            labelIcon={<Users className="h-4 w-4" />}
            href="/characters"
          />
        )}
        <UserButton.Link
          label={t('myOrders')}
          labelIcon={<Package className="h-4 w-4" />}
          href="/orders"
        />
      </UserButton.MenuItems>
    </UserButton>
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
              src="https://res.cloudinary.com/storywink/image/upload/f_auto,q_auto,h_124/v1772291379/Screenshot_2026-02-28_at_10.55.32_PM_copy_xxjms6.png"
              alt={t('mascotAlt')}
              width={124}
              height={62}
              className="h-[62px] w-auto"
              style={{ width: 'auto', height: '62px' }}
              priority
            />
            <span className="hidden font-bold text-3xl sm:inline-block text-ink dark:text-white font-playful">
              Storywin<span className="text-coral">k.ai</span>
            </span>
          </Link>
        </div>

        {/* Mobile Logo */}
        <div className="flex items-center md:hidden">
          <Link href="/" className="flex items-center space-x-2">
            <Image
              src="https://res.cloudinary.com/storywink/image/upload/f_auto,q_auto,h_104/v1772291379/Screenshot_2026-02-28_at_10.55.32_PM_copy_xxjms6.png"
              alt={t('mascotAlt')}
              width={104}
              height={52}
              className="h-[52px] w-auto"
              style={{ width: 'auto', height: '52px' }}
              priority
            />
            <span className="font-bold text-2xl sm:inline-block text-ink dark:text-white font-playful">
              Storywin<span className="text-coral">k.ai</span>
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
                 <Button asChild className="group font-playful">
                   <Link href="/library">
                     {t('toMyStories')}
                     <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                   </Link>
                 </Button>
                 <NotificationBell />
                 <LanguageSwitcher />
                 <div className="flex items-center ml-2">
                   <UserMenu />
                 </div>
             </SignedIn>
          </div>

          {/* Mobile: Language + Notification Bell + Menu Trigger */}
          <div className="flex items-center md:hidden">
            <LanguageSwitcher />
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
            <SignedIn>
              <Button asChild className="group font-playful w-fit">
                <Link href="/library" onClick={() => setIsMobileMenuOpen(false)}>
                  {t('toMyStories')}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
              {process.env.NEXT_PUBLIC_AVATARS_ENABLED === 'true' && (
                <Button asChild variant="outline" className="font-playful w-fit">
                  <Link href="/characters" onClick={() => setIsMobileMenuOpen(false)}>
                    <Users className="h-4 w-4" />
                    {t('myCharacters')}
                  </Link>
                </Button>
              )}
              <div className="py-2">
                <UserMenu />
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
      {/* Seamless scalloped cloud edge below the header */}
      <ScallopEdge className="absolute left-0 right-0 z-30" style={{ bottom: '-20px' }} />
    </header>
  );
} 