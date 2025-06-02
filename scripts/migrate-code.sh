#!/bin/bash

# Storywink Monorepo Migration Script
# This script helps migrate code from the existing Next.js app to the monorepo structure

set -e

echo "🚀 Starting Storywink monorepo migration..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Source and destination paths
SOURCE_DIR="../storywink.ai"
MONOREPO_DIR="."

# Check if source directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo -e "${RED}Error: Source directory $SOURCE_DIR not found${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 1: Migrating frontend code...${NC}"

# Create frontend directories
mkdir -p apps/web/src/{app,components,hooks,lib,styles}
mkdir -p apps/web/public

# Copy frontend files
cp -r $SOURCE_DIR/src/app/* apps/web/src/app/ 2>/dev/null || true
cp -r $SOURCE_DIR/src/components/* apps/web/src/components/ 2>/dev/null || true
cp -r $SOURCE_DIR/src/hooks/* apps/web/src/hooks/ 2>/dev/null || true
cp -r $SOURCE_DIR/src/styles/* apps/web/src/styles/ 2>/dev/null || true
cp -r $SOURCE_DIR/public/* apps/web/public/ 2>/dev/null || true

# Copy frontend configs
cp $SOURCE_DIR/next.config.mjs apps/web/
cp $SOURCE_DIR/tailwind.config.ts apps/web/ 2>/dev/null || true
cp $SOURCE_DIR/postcss.config.mjs apps/web/ 2>/dev/null || true
cp $SOURCE_DIR/.prettierrc apps/web/ 2>/dev/null || true

echo -e "${GREEN}✓ Frontend code migrated${NC}"

echo -e "${YELLOW}Step 2: Extracting API routes...${NC}"

# Create API directories
mkdir -p apps/api/src/{routes,services,utils}

# Note: API routes need to be manually extracted from Next.js API routes
echo -e "${YELLOW}  ⚠️  API routes need manual migration from src/app/api to apps/api/src/routes${NC}"
echo -e "${YELLOW}  ⚠️  Update imports to use Express.js syntax${NC}"

echo -e "${YELLOW}Step 3: Migrating workers...${NC}"

# Create workers directories
mkdir -p apps/workers/src/{workers,utils}

# Copy worker files
cp -r $SOURCE_DIR/src/queues/workers/* apps/workers/src/workers/ 2>/dev/null || true

echo -e "${GREEN}✓ Workers migrated${NC}"

echo -e "${YELLOW}Step 4: Migrating shared utilities...${NC}"

# Copy lib utilities to API (they'll need to be refactored)
mkdir -p apps/api/src/lib
cp -r $SOURCE_DIR/src/lib/* apps/api/src/lib/ 2>/dev/null || true

echo -e "${GREEN}✓ Utilities migrated${NC}"

echo -e "${YELLOW}Step 5: Creating docker-compose.yml...${NC}"

cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: storywink
      POSTGRES_PASSWORD: storywink123
      POSTGRES_DB: storywink
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
EOF

echo -e "${GREEN}✓ docker-compose.yml created${NC}"

echo -e "${YELLOW}Step 6: Final steps...${NC}"

# Make scripts executable
chmod +x scripts/*.sh 2>/dev/null || true

echo -e "${GREEN}✅ Migration script completed!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Install dependencies: npm install"
echo "2. Update imports in frontend code:"
echo "   - Change '@/lib' imports to use API calls"
echo "   - Update API endpoint URLs to use NEXT_PUBLIC_API_URL"
echo "3. Manually migrate API routes from Next.js to Express"
echo "4. Update environment variables in each app"
echo "5. Run 'npm run dev' to test the setup"
echo ""
echo -e "${YELLOW}Important changes needed:${NC}"
echo "- API calls in frontend: Change from '/api/...' to '\${NEXT_PUBLIC_API_URL}/api/...'"
echo "- Authentication: Ensure Clerk middleware works in Express"
echo "- File uploads: Implement multer in Express for file handling"
echo "- CORS: Already configured in apps/api/src/middleware/cors.ts"