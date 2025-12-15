-- AlterTable
ALTER TABLE "PrintOrder" ADD COLUMN     "shippingTier" TEXT,
ALTER COLUMN "shippingCountry" SET DEFAULT 'SG';
