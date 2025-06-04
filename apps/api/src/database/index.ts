export * from "@prisma/client";

// Import and re-export prisma client
import prismaClient from "./client.js";
export default prismaClient;
export { prismaClient as prisma };
