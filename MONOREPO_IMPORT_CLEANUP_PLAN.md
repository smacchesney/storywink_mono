# Monorepo Import Architecture Cleanup Plan

## Executive Summary

This plan addresses a critical architectural issue where shared code has been duplicated across multiple local directories to work around TypeScript/ES module import resolution problems. The current state creates maintenance hell, type inconsistencies, and deployment failures.

**Goal**: Eliminate code duplication, standardize on `@storywink/shared` package imports, and create a sustainable monorepo architecture.

## Current State Analysis

### 1. Code Duplication Crisis

**Problem**: Shared code exists in 3 locations with inconsistencies:

```bash
# Verify current duplication
ls -la packages/shared/src/
ls -la apps/api/src/shared/
ls -la apps/workers/src/shared/
```

**Expected findings**:
- All 3 directories contain similar files: `constants.ts`, `schemas.ts`, `types.ts`, `index.ts`
- `packages/shared/src/` has additional files: `utils.ts`, `prompts/` directory
- Local copies have outdated/inconsistent content

### 2. Import Strategy Inconsistencies

**Check current import patterns**:
```bash
# Find all @storywink/shared imports
grep -r "@storywink/shared" apps/ --include="*.ts" --include="*.tsx"

# Find all relative shared imports  
grep -r "\.\./shared\|\.\/shared" apps/ --include="*.ts" --include="*.tsx"
```

**Expected findings**:
- API: Mostly `../shared/index.js` imports (6+ files)
- Workers: Mix of `@storywink/shared` and `../shared/index.js` (7+ files)
- Web: Mix of both strategies (6+ files)

### 3. Package Configuration Issues

**Verify current package exports**:
```bash
# Check shared package configuration
cat packages/shared/package.json | grep -A 10 -B 5 "main\|exports"
```

**Current problem**: Exports TypeScript source instead of built JavaScript:
```json
{
  "main": "./src/index.ts",     // ❌ TypeScript source
  "exports": {
    ".": {
      "import": "./src/index.ts" // ❌ TypeScript source
    }
  }
}
```

## Detailed Execution Plan

### Phase 1: Pre-Cleanup Verification and Safety

#### Step 1.1: Document Current State
```bash
# Create backup documentation
echo "=== CURRENT IMPORT ANALYSIS ===" > /tmp/import-analysis.txt
echo "Files using @storywink/shared:" >> /tmp/import-analysis.txt
grep -r "@storywink/shared" apps/ --include="*.ts" --include="*.tsx" -l >> /tmp/import-analysis.txt
echo "" >> /tmp/import-analysis.txt
echo "Files using relative shared imports:" >> /tmp/import-analysis.txt
grep -r "\.\./shared\|\.\/shared" apps/ --include="*.ts" --include="*.tsx" -l >> /tmp/import-analysis.txt

# Document current shared directory contents
find packages/shared/src apps/api/src/shared apps/workers/src/shared -name "*.ts" 2>/dev/null | sort > /tmp/shared-files.txt
```

#### Step 1.2: Verify Build Infrastructure
```bash
# Check turbo.json configuration
cat turbo.json | grep -A 10 -B 5 "build"

# Verify package.json build scripts
find . -name "package.json" -path "*/apps/*" -exec echo "=== {} ===" \; -exec cat {} \; | grep -A 3 -B 3 "build"
```

#### Step 1.3: Content Comparison
```bash
# Compare constants files for inconsistencies
echo "=== CONSTANTS COMPARISON ===" > /tmp/constants-diff.txt
echo "packages/shared vs apps/api:" >> /tmp/constants-diff.txt
diff packages/shared/src/constants.ts apps/api/src/shared/constants.ts >> /tmp/constants-diff.txt 2>&1 || true
echo "" >> /tmp/constants-diff.txt
echo "packages/shared vs apps/workers:" >> /tmp/constants-diff.txt  
diff packages/shared/src/constants.ts apps/workers/src/shared/constants.ts >> /tmp/constants-diff.txt 2>&1 || true

# Review differences
cat /tmp/constants-diff.txt
```

**Action**: Review output for critical differences. Note any custom modifications in local copies that need to be preserved.

### Phase 2: Package Infrastructure Setup

#### Step 2.1: Configure Shared Package Build
```bash
# Navigate to shared package
cd packages/shared
```

**Update `packages/shared/package.json`**:
```json
{
  "name": "@storywink/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./prompts": {
      "types": "./dist/prompts/index.d.ts", 
      "import": "./dist/prompts/index.js"
    },
    "./styles": {
      "types": "./dist/styles/index.d.ts",
      "import": "./dist/styles/index.js"
    }
  },
  "scripts": {
    "build": "tsc --outDir dist --declaration --declarationMap --sourceMap",
    "dev": "tsc --outDir dist --declaration --watch",
    "check-types": "tsc --noEmit",
    "clean": "rm -rf dist node_modules .turbo"
  },
  "dependencies": {
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

#### Step 2.2: Create Shared Package TypeScript Config
**Create `packages/shared/tsconfig.json`**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler", 
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": false,
    "esModuleInterop": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### Step 2.3: Test Shared Package Build
```bash
# Build shared package
cd packages/shared
npm run build

# Verify build output
ls -la dist/
ls -la dist/prompts/ 2>/dev/null || echo "No prompts directory built"
ls -la dist/styles/ 2>/dev/null || echo "No styles directory built"

# Verify main exports exist
test -f dist/index.js && echo "✅ dist/index.js exists" || echo "❌ dist/index.js missing"
test -f dist/index.d.ts && echo "✅ dist/index.d.ts exists" || echo "❌ dist/index.d.ts missing"
```

### Phase 3: Update Turbo Build Dependencies

#### Step 3.1: Configure Build Order
**Update `turbo.json`**:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"],
      "env": [
        "NODE_ENV",
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_CLERK_SIGN_IN_URL", 
        "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
        "NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL",
        "NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL",
        "NEXT_PUBLIC_APP_URL",
        "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME"
      ]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "start": {
      "dependsOn": ["build"]
    },
    "lint": {
      "outputs": []
    },
    "check-types": {
      "outputs": []
    },
    "clean": {
      "cache": false
    },
    "db:generate": {
      "cache": false,
      "outputs": ["node_modules/.prisma/**", "src/generated/**"]
    },
    "db:push": {
      "cache": false
    },
    "db:migrate": {
      "cache": false
    },
    "db:studio": {
      "cache": false,
      "persistent": true
    }
  }
}
```

#### Step 3.2: Test Build Dependencies
```bash
# Test that packages build before apps
cd /path/to/monorepo/root
npm run build --filter="@storywink/shared"
npm run build --filter="@storywink/api" 

# Verify API can import from built shared package
node -e "console.log('Testing import...'); import('@storywink/shared').then(m => console.log('✅ Import successful:', Object.keys(m))).catch(e => console.error('❌ Import failed:', e.message))"
```

### Phase 4: App Configuration Updates

#### Step 4.1: Update App TypeScript Configs

**For `apps/api/tsconfig.json`**:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "lib": ["ES2022"],
    "types": ["node"],
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "noEmit": false,
    "declaration": false,
    "declarationMap": false,
    "sourceMap": false,
    "skipLibCheck": true,
    "baseUrl": ".",
    "rootDir": "./src"
    // ❌ REMOVE: "paths" configuration
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**For `apps/workers/tsconfig.json`**:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "noEmit": false,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "lib": ["ES2022"],
    "types": ["node"],
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "baseUrl": ".",
    "rootDir": "./src"
    // ❌ REMOVE: "paths" configuration  
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### Step 4.2: Verify Package Dependencies

**Check that all apps have proper dependencies**:
```bash
# Verify API dependencies
grep -A 5 -B 5 "@storywink" apps/api/package.json

# Verify Workers dependencies  
grep -A 5 -B 5 "@storywink" apps/workers/package.json

# Verify Web dependencies
grep -A 5 -B 5 "@storywink" apps/web/package.json
```

**Expected**: Each should have:
```json
{
  "dependencies": {
    "@storywink/shared": "*",
    "@storywink/database": "*"
  }
}
```

### Phase 5: Import Migration

#### Step 5.1: Create Import Migration Script

**Create `scripts/migrate-imports.sh`**:
```bash
#!/bin/bash
set -e

echo "🔄 Migrating imports from local shared to @storywink/shared..."

# Files that need import migration
API_FILES=(
  "apps/api/src/routes/generate.ts"
  "apps/api/src/routes/books.ts" 
  "apps/api/src/routes/pages.ts"
  "apps/api/src/services/queue/index.ts"
  "apps/api/src/middleware/ensureDbUser.ts"
  "apps/api/src/shared/index.ts"
)

WORKER_FILES=(
  "apps/workers/src/index.ts"
  "apps/workers/src/workers/story-generation.worker.ts"
  "apps/workers/src/workers/book-finalize.worker.ts"
  "apps/workers/src/shared/index.ts"
  "apps/workers/src/database/index.ts"
)

# Migrate API files
echo "📁 Migrating API files..."
for file in "${API_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "  - Processing $file"
    # Replace relative shared imports
    sed -i.bak 's|from "\.\./shared/index\.js"|from "@storywink/shared"|g' "$file"
    sed -i.bak 's|from "\./shared/index\.js"|from "@storywink/shared"|g' "$file"
    sed -i.bak 's|from "\.\./shared"|from "@storywink/shared"|g' "$file"
    sed -i.bak 's|from "\./shared"|from "@storywink/shared"|g' "$file"
  fi
done

# Migrate Worker files
echo "📁 Migrating Worker files..."
for file in "${WORKER_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "  - Processing $file"
    # Replace relative shared imports
    sed -i.bak 's|from "\.\./shared/index\.js"|from "@storywink/shared"|g' "$file"
    sed -i.bak 's|from "\./shared/index\.js"|from "@storywink/shared"|g' "$file"
    sed -i.bak 's|from "\.\./shared"|from "@storywink/shared"|g' "$file"
    sed -i.bak 's|from "\./shared"|from "@storywink/shared"|g' "$file"
  fi
done

echo "✅ Import migration complete. Review changes before proceeding."
echo "💡 Backup files created with .bak extension."
```

#### Step 5.2: Execute Import Migration
```bash
# Make script executable
chmod +x scripts/migrate-imports.sh

# Run migration
./scripts/migrate-imports.sh

# Review changes
echo "=== REVIEWING IMPORT CHANGES ==="
find apps/ -name "*.bak" -exec echo "Original: {}" \; -exec echo "Modified: {}" \; -exec diff {} "$(basename {} .bak)" \; 2>/dev/null || true
```

#### Step 5.3: Manual Import Fixes

**Critical files requiring manual review**:

1. **`apps/api/src/lib/openai/prompts.ts`**:
   - Currently: `export { ... } from "@storywink/shared";`
   - Action: Verify it works with built package

2. **`apps/workers/src/workers/illustration-generation.worker.ts`**:
   - Currently: `import { ..., STYLE_LIBRARY, StyleKey } from '@storywink/shared';`
   - Action: Verify style library exports correctly

3. **Files with mixed imports**:
   ```bash
   # Find files with both import types
   grep -l "@storywink/shared" apps/**/*.ts | xargs grep -l "\.\./shared\|\.\/shared"
   ```

### Phase 6: Remove Local Shared Directories

#### Step 6.1: Backup Local Modifications

**Check for custom modifications**:
```bash
# Compare all shared files to identify custom changes
echo "=== CHECKING FOR CUSTOM MODIFICATIONS ===" > /tmp/custom-changes.txt

# Compare constants
echo "--- API Constants Diff ---" >> /tmp/custom-changes.txt
diff packages/shared/src/constants.ts apps/api/src/shared/constants.ts >> /tmp/custom-changes.txt 2>&1 || true

echo "--- Workers Constants Diff ---" >> /tmp/custom-changes.txt  
diff packages/shared/src/constants.ts apps/workers/src/shared/constants.ts >> /tmp/custom-changes.txt 2>&1 || true

# Compare schemas
echo "--- API Schemas Diff ---" >> /tmp/custom-changes.txt
diff packages/shared/src/schemas.ts apps/api/src/shared/schemas.ts >> /tmp/custom-changes.txt 2>&1 || true

echo "--- Workers Schemas Diff ---" >> /tmp/custom-changes.txt
diff packages/shared/src/schemas.ts apps/workers/src/shared/schemas.ts >> /tmp/custom-changes.txt 2>&1 || true

# Compare types
echo "--- API Types Diff ---" >> /tmp/custom-changes.txt
diff packages/shared/src/types.ts apps/api/src/shared/types.ts >> /tmp/custom-changes.txt 2>&1 || true

echo "--- Workers Types Diff ---" >> /tmp/custom-changes.txt
diff packages/shared/src/types.ts apps/workers/src/shared/types.ts >> /tmp/custom-changes.txt 2>&1 || true

# Review findings
cat /tmp/custom-changes.txt
```

**Action**: Review output. If custom modifications exist, manually merge them into `packages/shared/src/` before deletion.

#### Step 6.2: Create Deletion Backup
```bash
# Create backup before deletion
mkdir -p /tmp/shared-backup/
cp -r apps/api/src/shared /tmp/shared-backup/api-shared 2>/dev/null || true
cp -r apps/workers/src/shared /tmp/shared-backup/workers-shared 2>/dev/null || true

echo "📦 Backup created at /tmp/shared-backup/"
ls -la /tmp/shared-backup/
```

#### Step 6.3: Remove Local Shared Directories
```bash
# Remove API shared directory
if [ -d "apps/api/src/shared" ]; then
  echo "🗑️  Removing apps/api/src/shared..."
  rm -rf apps/api/src/shared
fi

# Remove Workers shared directory  
if [ -d "apps/workers/src/shared" ]; then
  echo "🗑️  Removing apps/workers/src/shared..."
  rm -rf apps/workers/src/shared
fi

echo "✅ Local shared directories removed"
```

### Phase 7: Build and Test

#### Step 7.1: Full Clean Build Test
```bash
# Clean all build artifacts
npm run clean

# Build shared package first
npm run build --filter="@storywink/shared"

# Verify shared package built correctly
ls -la packages/shared/dist/
test -f packages/shared/dist/index.js && echo "✅ Shared package built successfully"

# Build all apps
npm run build --filter="@storywink/api"
npm run build --filter="@storywink/workers"  
npm run build --filter="@storywink/web"
```

#### Step 7.2: Runtime Testing
```bash
# Test API imports
cd apps/api
echo "🧪 Testing API imports..."
node -e "
  import('@storywink/shared')
    .then(m => console.log('✅ API can import shared:', Object.keys(m).slice(0, 5)))
    .catch(e => console.error('❌ API import failed:', e.message))
"

# Test Workers imports  
cd ../workers
echo "🧪 Testing Workers imports..."
node -e "
  import('@storywink/shared')
    .then(m => console.log('✅ Workers can import shared:', Object.keys(m).slice(0, 5)))
    .catch(e => console.error('❌ Workers import failed:', e.message))
"
```

#### Step 7.3: Type Checking
```bash
# Run type checking on all apps
npm run check-types --filter="@storywink/api"
npm run check-types --filter="@storywink/workers"
npm run check-types --filter="@storywink/web"

echo "✅ Type checking complete"
```

### Phase 8: Production Verification

#### Step 8.1: Local Production Simulation
```bash
# Build and start API in production mode
cd apps/api
npm run build
npm run start &
API_PID=$!

# Wait for startup
sleep 5

# Test API endpoint
curl -f http://localhost:8080/api/health || echo "❌ API health check failed"

# Stop API
kill $API_PID 2>/dev/null || true
```

#### Step 8.2: Workers Production Test
```bash
# Build and start workers
cd apps/workers
npm run build
timeout 10s npm run start || echo "Workers started successfully (timeout expected)"
```

### Phase 9: Database Package Extension (Optional)

If `@storywink/database` has similar issues:

#### Step 9.1: Check Database Package
```bash
# Check if database package exports source
cat packages/database/package.json | grep -A 5 -B 5 "main\|exports"

# Check for local database copies
find apps/ -name "database" -type d
```

#### Step 9.2: Apply Same Pattern
```bash
# Update database package.json if needed
# Follow same pattern as shared package
# Update imports from ../database to @storywink/database
```

## Rollback Procedures

### Emergency Rollback (If Build Breaks)

1. **Restore Local Shared Directories**:
   ```bash
   cp -r /tmp/shared-backup/api-shared apps/api/src/shared
   cp -r /tmp/shared-backup/workers-shared apps/workers/src/shared
   ```

2. **Restore Import Files**:
   ```bash
   find apps/ -name "*.bak" -exec bash -c 'mv "$1" "${1%.bak}"' _ {} \;
   ```

3. **Restore TypeScript Configs**:
   ```bash
   git checkout -- apps/api/tsconfig.json
   git checkout -- apps/workers/tsconfig.json
   ```

4. **Test Rollback**:
   ```bash
   npm run build
   ```

### Partial Rollback (If Only Some Apps Break)

1. **Rollback Specific App**:
   ```bash
   # For API only
   cp -r /tmp/shared-backup/api-shared apps/api/src/shared
   find apps/api -name "*.bak" -exec bash -c 'mv "$1" "${1%.bak}"' _ {} \;
   git checkout -- apps/api/tsconfig.json
   ```

## Success Criteria

### ✅ Completion Checklist

- [ ] `packages/shared` builds successfully to `dist/` 
- [ ] No local `shared/` directories in `apps/`
- [ ] All imports use `@storywink/shared`
- [ ] All apps build without errors
- [ ] All apps pass type checking
- [ ] API starts and serves `/api/health`
- [ ] Workers start without import errors
- [ ] Web builds successfully

### ✅ Quality Verification

- [ ] No code duplication between packages
- [ ] Consistent status constants across all apps
- [ ] Access to full shared functionality (utils, prompts)
- [ ] Proper TypeScript intellisense in IDEs
- [ ] Clean build output structure
- [ ] Railway deployment succeeds

## Expected Timeline

- **Preparation & Analysis**: 2-3 hours
- **Package Setup**: 1-2 hours  
- **Import Migration**: 2-4 hours
- **Testing & Verification**: 2-3 hours
- **Total**: 1-2 days for careful execution

## Known Gotchas

1. **Status Message Casing**: Local copies use lowercase, package uses UPPERCASE
2. **Missing Utils**: Local copies lack `isTitlePage()` and `categorizePages()`
3. **Prompt Architecture**: Only in package, not in local copies
4. **TypeScript Module Resolution**: Ensure `moduleResolution: "bundler"` is consistent
5. **Railway Build Order**: Ensure packages build before apps in CI/CD

## Post-Cleanup Benefits

- ✅ **Single source of truth** for shared code
- ✅ **Consistent types and constants** across all apps
- ✅ **Access to full shared functionality** (utils, prompts)
- ✅ **Easier maintenance** - changes in one place
- ✅ **Better IDE support** with proper package resolution
- ✅ **Cleaner build processes** 
- ✅ **Elimination of stale/inconsistent code**
- ✅ **Sustainable monorepo architecture**

---

*This plan eliminates the architectural debt that has accumulated from workarounds, creating a clean, maintainable foundation for future development.*