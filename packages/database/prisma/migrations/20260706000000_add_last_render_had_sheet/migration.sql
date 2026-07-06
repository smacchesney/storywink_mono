-- AlterTable (additive-only): render-time stamp of whether the render
-- actually received character-sheet refs. Nullable so pre-feature renders
-- stay distinguishable from sheetless ones.
ALTER TABLE "Page" ADD COLUMN "lastRenderHadSheet" BOOLEAN;
