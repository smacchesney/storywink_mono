import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from '@clerk/nextjs';
import dynamic from 'next/dynamic';
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: 'swap',
  preload: true,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://storywink.ai'),
  title: {
    default: "Storywink - AI Storybooks from Your Photos",
    template: "%s | Storywink"
  },
  description: "Transform your photos into personalized, illustrated children's storybooks with AI. Create magical stories featuring your child as the hero in minutes.",
  keywords: ["AI storybooks", "personalized children's books", "photo to illustration", "custom storybooks", "AI children's stories"],
  authors: [{ name: "Storywink" }],
  creator: "Storywink",
  publisher: "Storywink",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: '/',
    siteName: 'Storywink',
    title: 'Storywink - AI Storybooks from Your Photos',
    description: 'Transform your photos into personalized, illustrated children\'s storybooks with AI.',
    images: [{
      url: '/og-image.jpg',
      width: 1200,
      height: 630,
      alt: 'Storywink - AI Storybooks',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Storywink - AI Storybooks from Your Photos',
    description: 'Transform your photos into personalized, illustrated children\'s storybooks with AI.',
    images: ['/og-image.jpg'],
    creator: '@storywink',
  },
  alternates: {
    canonical: '/',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' }
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-screen`}
        >
          <SiteHeader />
          <main className="flex-grow">{children}</main>
          <SiteFooter />
          <Toaster 
            position="bottom-right"
            expand={false}
            richColors
            duration={3000}
            visibleToasts={3}
            closeButton
          />
        </body>
      </html>
    </ClerkProvider>
  );
}
