import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import { SUPPORTED_LANGUAGES } from '@storywink/shared/schemas';
import { LOCALE_COOKIE } from '@/i18n/locale';

export async function GET() {
  try {
    const { dbUser } = await getAuthenticatedUser();

    const profile = await prisma.userProfile.findUnique({
      where: { userId: dbUser.id },
      select: { preferredLanguage: true },
    });

    return NextResponse.json({ language: profile?.preferredLanguage || 'en' });
  } catch {
    return NextResponse.json({ language: 'en' });
  }
}

export async function PATCH(request: Request) {
  try {
    const { dbUser } = await getAuthenticatedUser();
    const body = await request.json();
    const { language } = body;

    if (!language || !(SUPPORTED_LANGUAGES as readonly string[]).includes(language)) {
      return NextResponse.json({ error: 'Invalid language' }, { status: 400 });
    }

    // Upsert profile with preferred language
    await prisma.userProfile.upsert({
      where: { userId: dbUser.id },
      update: { preferredLanguage: language },
      create: { userId: dbUser.id, preferredLanguage: language },
    });

    // Set the locale cookie so next page load uses it
    const response = NextResponse.json({ language });
    response.cookies.set(LOCALE_COOKIE, language, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update language' },
      { status: 500 },
    );
  }
}
