import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { SUPPORTED_LANGUAGES } from '@storywink/shared/schemas';

const LOCALE_COOKIE = 'storywink-locale';

// Define public routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
  '/api/health',
  '/pricing',
  '/privacy',
  '/terms',
]);

/**
 * Parse Accept-Language header and find the best matching supported locale.
 * e.g. "ja,en;q=0.9,zh;q=0.8" -> "ja"
 */
function negotiateLocale(header: string): string {
  const langs = header.split(',').map(part => {
    const [lang, q] = part.trim().split(';q=');
    return { lang: lang.split('-')[0].toLowerCase(), q: q ? parseFloat(q) : 1 };
  }).sort((a, b) => b.q - a.q);

  for (const { lang } of langs) {
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) return lang;
  }
  return 'en';
}

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }

  // Locale detection: set cookie from Accept-Language on first visit
  if (!req.cookies.get(LOCALE_COOKIE)) {
    const acceptLang = req.headers.get('Accept-Language') || '';
    const detected = negotiateLocale(acceptLang);
    const response = NextResponse.next();
    response.cookies.set(LOCALE_COOKIE, detected, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });
    return response;
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};