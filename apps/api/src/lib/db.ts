import { PrismaClient } from "@prisma/client";

// Declare a global variable to hold the Prisma client instance
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Initialize PrismaClient, reusing the instance in development
export const db =
  globalThis.__prisma ||
  new PrismaClient({
    // Optional: Log database queries during development
    // log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

// Store the instance in the global variable in development
if (process.env.NODE_ENV !== "production") globalThis.__prisma = db;
