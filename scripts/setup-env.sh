#!/bin/bash

# Setup environment variables for all services

# Read values from the original .env file
source ../storywink.ai/.env

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Setting up environment variables...${NC}"

# Web service environment variables
cat > apps/web/.env.local << EOF
# API URL
NEXT_PUBLIC_API_URL=http://localhost:3001

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY=$CLERK_SECRET_KEY

# Clerk URLs
NEXT_PUBLIC_CLERK_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_URL
NEXT_PUBLIC_CLERK_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_URL
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/library
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/library

# Cloudinary
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=$CLOUDINARY_CLOUD_NAME

# App URL
NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
EOF

echo -e "${GREEN}✓ Web environment variables set${NC}"

# API service environment variables
cat > apps/api/.env.local << EOF
# Database
DATABASE_URL=$DATABASE_URL
REDIS_URL=$REDIS_URL

# Server
PORT=3001
NODE_ENV=development

# Clerk Authentication
CLERK_SECRET_KEY=$CLERK_SECRET_KEY
CLERK_WEBHOOK_SECRET=${CLERK_WEBHOOK_SECRET:-whsec_your_webhook_secret}

# OpenAI
OPENAI_API_KEY=$OPENAI_API_KEY

# Cloudinary
CLOUDINARY_CLOUD_NAME=$CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY=$CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET=$CLOUDINARY_API_SECRET

# Frontend URL (for CORS)
NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

# Log Level
LOG_LEVEL=$LOG_LEVEL
EOF

echo -e "${GREEN}✓ API environment variables set${NC}"

# Workers service environment variables
cat > apps/workers/.env.local << EOF
# Database
DATABASE_URL=$DATABASE_URL
REDIS_URL=$REDIS_URL

# Environment
NODE_ENV=development

# OpenAI
OPENAI_API_KEY=$OPENAI_API_KEY

# Cloudinary
CLOUDINARY_CLOUD_NAME=$CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY=$CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET=$CLOUDINARY_API_SECRET

# Log Level
LOG_LEVEL=$LOG_LEVEL
EOF

echo -e "${GREEN}✓ Workers environment variables set${NC}"

echo -e "${GREEN}✅ All environment variables configured!${NC}"