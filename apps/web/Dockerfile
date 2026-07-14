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
COPY apps/workers/package.json ./apps/workers/
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/
COPY packages/pdf/package.json ./packages/pdf/

# Copy Prisma schema BEFORE npm ci (postinstall hook needs it)
COPY packages/database/prisma ./packages/database/prisma

# Install dependencies (postinstall will run prisma generate)
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Accept build arguments for Next.js public environment variables.
# Docker only receives Railway variables that are DECLARED here — an
# undeclared NEXT_PUBLIC_* is silently absent from the client bundle
# (that gap kept the character library dark on the first flag flip).
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_AVATARS_ENABLED
ARG NEXT_PUBLIC_COLLAGE_PAGES_ENABLED
ARG NEXT_PUBLIC_STORY_HELPER_ENABLED
ARG AVATARS_ENABLED
ARG COLLAGE_PAGES_ENABLED
ARG CHARACTER_SHEETS_ENABLED
ARG BRIDGE_PAGES_ENABLED
ARG STORY_HELPER_ENABLED
ARG RAILWAY_GIT_COMMIT_SHA

# Set environment variables for build time. The server-side flags ride along
# so any route Next statically evaluates at build bakes the SAME answer the
# runtime env gives (their runtime values still come from Railway directly).
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_AVATARS_ENABLED=$NEXT_PUBLIC_AVATARS_ENABLED
ENV NEXT_PUBLIC_COLLAGE_PAGES_ENABLED=$NEXT_PUBLIC_COLLAGE_PAGES_ENABLED
ENV NEXT_PUBLIC_STORY_HELPER_ENABLED=$NEXT_PUBLIC_STORY_HELPER_ENABLED
ENV AVATARS_ENABLED=$AVATARS_ENABLED
ENV COLLAGE_PAGES_ENABLED=$COLLAGE_PAGES_ENABLED
ENV CHARACTER_SHEETS_ENABLED=$CHARACTER_SHEETS_ENABLED
ENV BRIDGE_PAGES_ENABLED=$BRIDGE_PAGES_ENABLED
ENV STORY_HELPER_ENABLED=$STORY_HELPER_ENABLED

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