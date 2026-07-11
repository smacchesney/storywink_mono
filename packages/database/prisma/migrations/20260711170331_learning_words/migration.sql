-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "learningWords" JSONB;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "learningWordsUsed" TEXT[] DEFAULT ARRAY[]::TEXT[];
