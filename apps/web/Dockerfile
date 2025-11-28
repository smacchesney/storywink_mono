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
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_API_URL
ARG RAILWAY_GIT_COMMIT_SHA

# Set environment variables for build time
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/package-lock.json ./package-lock.json
COPY --from=deps /app/turbo.json ./turbo.json

# Copy all source files
# Cache bust: 2025-11-28
COPY . .

# Build the web app
RUN npm run build --filter=@storywink/web

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install Chromium and dependencies for PDF generation
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Point Puppeteer to system Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy entire monorepo structure (needed for workspace dependencies)
COPY --from=builder /app ./

# Change to web directory
WORKDIR /app/apps/web

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "run", "start"]