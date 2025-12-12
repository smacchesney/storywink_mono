-- CreateEnum
CREATE TYPE "PrintOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAYMENT_COMPLETED', 'SUBMITTED_TO_LULU', 'IN_PRODUCTION', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "status" "PrintOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "luluPrintJobId" TEXT,
    "podPackageId" TEXT,
    "pageCount" INTEGER,
    "interiorPdfUrl" TEXT,
    "coverPdfUrl" TEXT,
    "printCost" INTEGER,
    "shippingCost" INTEGER,
    "taxAmount" INTEGER,
    "totalAmount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "stripeSessionId" TEXT,
    "stripePaymentId" TEXT,
    "shippingName" TEXT,
    "shippingStreet1" TEXT,
    "shippingStreet2" TEXT,
    "shippingCity" TEXT,
    "shippingState" TEXT,
    "shippingPostcode" TEXT,
    "shippingCountry" TEXT NOT NULL DEFAULT 'US',
    "shippingPhone" TEXT,
    "contactEmail" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "estimatedDelivery" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "PrintOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CartItem_userId_idx" ON "CartItem"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_userId_bookId_key" ON "CartItem"("userId", "bookId");

-- CreateIndex
CREATE INDEX "PrintOrder_userId_idx" ON "PrintOrder"("userId");

-- CreateIndex
CREATE INDEX "PrintOrder_bookId_idx" ON "PrintOrder"("bookId");

-- CreateIndex
CREATE INDEX "PrintOrder_status_idx" ON "PrintOrder"("status");

-- CreateIndex
CREATE INDEX "PrintOrder_luluPrintJobId_idx" ON "PrintOrder"("luluPrintJobId");

-- CreateIndex
CREATE INDEX "PrintOrder_stripeSessionId_idx" ON "PrintOrder"("stripeSessionId");

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintOrder" ADD CONSTRAINT "PrintOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintOrder" ADD CONSTRAINT "PrintOrder_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
