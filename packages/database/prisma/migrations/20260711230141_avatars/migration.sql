-- CreateEnum
CREATE TYPE "BookType" AS ENUM ('PHOTO_STORY', 'AVATAR_STORY');

-- CreateEnum
CREATE TYPE "AvatarKind" AS ENUM ('CHILD', 'ADULT', 'PET', 'TOY');

-- CreateEnum
CREATE TYPE "AvatarStatus" AS ENUM ('DRAFT', 'READY');

-- CreateEnum
CREATE TYPE "RenditionStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "bookType" "BookType" NOT NULL DEFAULT 'PHOTO_STORY';

-- CreateTable
CREATE TABLE "Avatar" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "kind" "AvatarKind" NOT NULL,
    "status" "AvatarStatus" NOT NULL DEFAULT 'DRAFT',
    "identity" JSONB,
    "promotedFromBookId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Avatar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvatarRendition" (
    "id" TEXT NOT NULL,
    "avatarId" TEXT NOT NULL,
    "artStyle" TEXT NOT NULL,
    "status" "RenditionStatus" NOT NULL DEFAULT 'PENDING',
    "turnaroundSheetUrl" TEXT,
    "portraitUrl" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "validatedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvatarRendition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvatarPhoto" (
    "avatarId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvatarPhoto_pkey" PRIMARY KEY ("avatarId","assetId")
);

-- CreateTable
CREATE TABLE "BookAvatar" (
    "bookId" TEXT NOT NULL,
    "avatarId" TEXT NOT NULL,
    "characterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookAvatar_pkey" PRIMARY KEY ("bookId","avatarId")
);

-- CreateIndex
CREATE INDEX "Avatar_userId_idx" ON "Avatar"("userId");

-- CreateIndex
CREATE INDEX "AvatarRendition_avatarId_idx" ON "AvatarRendition"("avatarId");

-- CreateIndex
CREATE UNIQUE INDEX "AvatarRendition_avatarId_artStyle_key" ON "AvatarRendition"("avatarId", "artStyle");

-- CreateIndex
CREATE INDEX "AvatarPhoto_assetId_idx" ON "AvatarPhoto"("assetId");

-- CreateIndex
CREATE INDEX "BookAvatar_avatarId_idx" ON "BookAvatar"("avatarId");

-- AddForeignKey
ALTER TABLE "Avatar" ADD CONSTRAINT "Avatar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvatarRendition" ADD CONSTRAINT "AvatarRendition_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "Avatar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvatarPhoto" ADD CONSTRAINT "AvatarPhoto_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "Avatar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvatarPhoto" ADD CONSTRAINT "AvatarPhoto_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookAvatar" ADD CONSTRAINT "BookAvatar_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookAvatar" ADD CONSTRAINT "BookAvatar_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "Avatar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
