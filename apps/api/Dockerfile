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

# Copy Prisma schema BEFORE npm ci (postinstall hook needs it)
COPY packages/database/prisma ./packages/database/prisma

# Install dependencies (postinstall will run prisma generate)
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Accept build arguments for Next.js public environment variables
# (needed because Turbo builds web service as dependency)
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_API_URL

# Set environment variables for build time
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Copy node_modules from deps stage
COPY --from=deps /app ./

# Copy all source files
COPY . .

# Build the API app
RUN npm run build --filter=@storywink/api

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy entire monorepo structure (needed for workspace dependencies)
COPY --from=builder /app ./

# Change to API directory
WORKDIR /app/apps/api

EXPOSE 4000

ENV PORT=4000

CMD ["npm", "run", "start"]