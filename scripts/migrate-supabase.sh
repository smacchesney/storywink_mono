#!/bin/bash
# Script to run Prisma migrations against Supabase

set -e  # Exit on error

echo "🚀 Starting Supabase migration process..."

# Check if .env.migration exists
if [ ! -f .env.migration ]; then
    echo "❌ Error: .env.migration file not found!"
    echo "Please create .env.migration with your Supabase connection strings"
    exit 1
fi

# Load migration environment variables
export $(cat .env.migration | grep -v '^#' | xargs)

# Validate environment variables
if [ -z "$DIRECT_URL" ] || [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DIRECT_URL and DATABASE_URL must be set in .env.migration"
    exit 1
fi

# Check if URLs contain placeholder values
if [[ "$DIRECT_URL" == *"[YOUR-PASSWORD]"* ]] || [[ "$DIRECT_URL" == *"[PROJECT-REF]"* ]]; then
    echo "❌ Error: Please replace placeholder values in .env.migration with your actual Supabase credentials"
    exit 1
fi

echo "📦 Installing dependencies..."
npm install

echo "🔧 Generating Prisma Client..."
npm run db:generate

echo "📊 Checking migration status..."
cd packages/database
npx prisma migrate status

echo ""
echo "🔄 Running migrations..."
echo "Using direct connection for DDL operations"
npx prisma migrate deploy

echo ""
echo "✅ Migration completed successfully!"
echo ""
echo "📝 Next steps:"
echo "1. Verify the migrations in your Supabase dashboard"
echo "2. Update your Railway environment variables:"
echo "   - Use the SESSION POOLER connection string for DATABASE_URL"
echo "3. Do NOT commit .env.migration to git"

# Return to root directory
cd ../..