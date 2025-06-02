/*  STEP 1 – add the column *nullable* so the table change is allowed  */
ALTER TABLE "User"
ADD COLUMN "clerkId" TEXT;               -- no NOT NULL yet, no UNIQUE yet

/*  STEP 2 – back‑fill the new column for pre‑existing rows           */
/*          (old primary key ‘id’ already contains the Clerk ID)     */
UPDATE "User"
SET    "clerkId" = "id"
WHERE  "clerkId" IS NULL;

/*  STEP 3 – tighten the constraints now that every row has a value  */
ALTER TABLE "User"
ALTER COLUMN "clerkId" SET NOT NULL;

ALTER TABLE "User"
ADD CONSTRAINT "User_clerkId_key" UNIQUE ("clerkId");

/*  STEP 4 – keep or drop the old unique index on id, your choice.   */
/*          If id is still the PK it’s automatically unique anyway.  */
-- DROP INDEX IF EXISTS "User_id_key";
