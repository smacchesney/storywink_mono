# Use the same Node version as specified in package.json
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy root package files
COPY package.json package-lock.json ./
COPY turbo.json ./

# Copy workspace package files
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY apps/workers/package.json ./apps/workers/
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN npm ci

# Copy Prisma schema for generation
COPY packages/database/prisma ./packages/database/prisma

# Generate Prisma Client
RUN npm run db:generate

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Accept build arguments for Next.js public environment variables
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_API_URL

# Set environment variables for build time
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Copy node_modules from deps stage
COPY --from=deps /app ./

# Copy all source files
COPY . .

# Build the web app
RUN npm run build --filter=@storywink/web

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy entire monorepo structure (needed for workspace dependencies)
COPY --from=builder /app ./

# Change to web directory
WORKDIR /app/apps/web

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "run", "start"]