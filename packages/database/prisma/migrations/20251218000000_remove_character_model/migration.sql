-- Drop orphan tables that may reference Character (if they exist)
DROP TABLE IF EXISTS "CharacterIllustration" CASCADE;
DROP TABLE IF EXISTS "PageCharacter" CASCADE;

-- DropForeignKey
ALTER TABLE "Character" DROP CONSTRAINT IF EXISTS "Character_bookId_fkey";

-- DropForeignKey
ALTER TABLE "Character" DROP CONSTRAINT IF EXISTS "Character_sourceAssetId_fkey";

-- DropTable
DROP TABLE IF EXISTS "Character" CASCADE;
