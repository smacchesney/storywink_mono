import { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import prisma from "../database/index.js";

export interface AuthenticatedRequest extends Request {
  dbUser?: {
    id: string;
    clerkId: string;
    email: string;
    name: string | null;
  };
}

/**
 * Middleware to ensure the authenticated user exists in the database.
 * Converts Clerk user ID to database user ID and attaches it to the request.
 */
export async function ensureDbUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const auth = getAuth(req);
    const clerkId = auth.userId;

    if (!clerkId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Get user details from Clerk
    const clerkUser = await clerkClient.users.getUser(clerkId);

    if (!clerkUser) {
      res.status(401).json({ error: "User not found in Clerk" });
      return;
    }

    const primaryEmail = clerkUser.emailAddresses.find(
      (email) => email.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress;

    if (!primaryEmail) {
      res.status(400).json({ error: "User has no primary email" });
      return;
    }

    // Upsert user in database
    const dbUser = await prisma.user.upsert({
      where: { clerkId },
      update: {
        email: primaryEmail,
        name: clerkUser.firstName
          ? `${clerkUser.firstName} ${clerkUser.lastName || ""}`.trim()
          : null,
        imageUrl: clerkUser.imageUrl || null,
      },
      create: {
        clerkId,
        email: primaryEmail,
        name: clerkUser.firstName
          ? `${clerkUser.firstName} ${clerkUser.lastName || ""}`.trim()
          : null,
        imageUrl: clerkUser.imageUrl || null,
      },
    });

    // Attach database user to request
    req.dbUser = dbUser;
    next();
  } catch (error) {
    console.error("Error in ensureDbUser middleware:", error);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
}
