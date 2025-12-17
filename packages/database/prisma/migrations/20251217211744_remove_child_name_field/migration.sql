-- AlterTable - Remove childName from Book model
-- Note: This is a breaking change. childName is now derived from Character names during story generation.
ALTER TABLE "Book" DROP COLUMN "childName";
