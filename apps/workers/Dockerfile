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
ARG RAILWAY_GIT_COMMIT_SHA

# Set environment variables for build time
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/package-lock.json ./package-lock.json
COPY --from=deps /app/turbo.json ./turbo.json

# Copy all source files (including the fixed source code)
COPY . .

# Build workers (with dependencies) but exclude web
RUN npx turbo run build --filter=@storywink/workers --filter='!@storywink/web'

# Production image
FROM base AS runner
WORKDIR /app

# Install Chromium and dependencies for PDF generation
# @sparticuz/chromium is designed for Lambda; system Chromium is more reliable in Docker
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto \
    font-noto-emoji

# Tell Puppeteer to use system Chromium instead of downloading its own
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

ENV NODE_ENV=production

# Copy entire monorepo structure (needed for workspace dependencies)
COPY --from=builder /app ./

# Change to workers directory
WORKDIR /app/apps/workers

CMD ["npm", "run", "start"]