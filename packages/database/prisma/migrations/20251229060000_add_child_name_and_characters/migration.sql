-- AlterTable - Add childName and additionalCharacters to Book model
-- These fields were previously removed but are needed for story personalization
ALTER TABLE "Book" ADD COLUMN "childName" TEXT;
ALTER TABLE "Book" ADD COLUMN "additionalCharacters" TEXT;
