-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "castMemberIds" JSONB,
ADD COLUMN     "castMode" TEXT NOT NULL DEFAULT 'star',
ADD COLUMN     "coverHeroAssetIds" JSONB,
ADD COLUMN     "starCharacterId" TEXT,
ADD COLUMN     "themeLine" TEXT;
