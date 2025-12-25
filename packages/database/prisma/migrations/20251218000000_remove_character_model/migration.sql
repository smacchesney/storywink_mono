-- DropForeignKey
ALTER TABLE "Character" DROP CONSTRAINT "Character_bookId_fkey";

-- DropForeignKey
ALTER TABLE "Character" DROP CONSTRAINT "Character_sourceAssetId_fkey";

-- DropTable
DROP TABLE "Character";
