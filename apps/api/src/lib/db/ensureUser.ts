import { PrismaClient } from "@prisma/client";
import { auth, currentUser } from "@clerk/nextjs/server";

const prisma = new PrismaClient();

export async function ensureUser(clerkUser: {
  id: string; // This is the Clerk ID
  email: string;
  name?: string | null; // Clerk's `firstName` and `lastName` might be separate or nullable
  imageUrl?: string | null;
}) {
  const { id: clerkId, email, name, imageUrl } = clerkUser;

  // Ensure name and imageUrl are not undefined, convert to null if they are
  const finalName = name === undefined ? null : name;
  const finalImageUrl = imageUrl === undefined ? null : imageUrl;

  // Upsert based on clerkId as the primary anchor.
  // This ensures that if a user exists with this clerkId, their details (like email) are updated.
  // If they don't exist, a new record is created.
  return prisma.user.upsert({
    where: { clerkId: clerkId } as any,
    update: {
      email: email,
      name: finalName,
      imageUrl: finalImageUrl,
      // updatedAt will be handled by Prisma's @updatedAt directive
    } as any,
    create: {
      clerkId: clerkId,
      email: email,
      name: finalName,
      imageUrl: finalImageUrl,
    } as any,
  });
}

/**
 * Helper function to get the database user ID from Clerk authentication.
 * This ensures we use the correct internal database user ID for all database operations.
 *
 * @returns Object containing both Clerk user data and the database user record
 * @throws Error if user is not authenticated or not found in database
 */
export async function getAuthenticatedUser() {
  const { userId: clerkId } = await auth();
  const user = await currentUser();

  if (!clerkId || !user) {
    throw new Error("User not authenticated");
  }

  // Check for ID mismatch
  if (clerkId !== user.id) {
    throw new Error("User ID mismatch between auth() and currentUser()");
  }

  // Extract primary email address
  const primaryEmail = user.emailAddresses.find(
    (email) => email.id === user.primaryEmailAddressId,
  )?.emailAddress;

  if (!primaryEmail) {
    throw new Error("User primary email not found");
  }

  // Ensure user exists in database and get the database user record
  const dbUser = await ensureUser({
    id: user.id, // Clerk ID
    email: primaryEmail,
    name: user.firstName
      ? `${user.firstName} ${user.lastName || ""}`.trim()
      : null,
    imageUrl: user.imageUrl,
  });

  return {
    clerkUser: user,
    clerkId: clerkId,
    dbUser: dbUser,
    primaryEmail: primaryEmail,
  };
}
