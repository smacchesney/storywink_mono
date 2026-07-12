# Photo Deletion Pipeline

Storywink stores children's photos, so deletion has to be real: when a parent deletes a book or their account, the binaries in Cloudinary must go too, not just the database rows. This page documents what gets deleted when, the environment flags, and how the pipeline backs the FAQ privacy promise ("we'll delete your photos whenever you ask", `landing.faq5A`). It also covers APPI/GDPR-style deletion expectations for the Japanese market.

## What gets deleted, and when

| Trigger                                                             | Database                                                                                                                                                | Cloudinary                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Book delete** (`DELETE /api/book/[bookId]`)                       | Book row + cascade (pages, notifications, QC results). Asset rows are user-scoped and stay.                                                             | Original photos the book references (unless another book of the user also references them), generated page illustrations, the cover render, character sheets, and the whole `storywink/<bookId>/` folder (catches renders superseded by QC rounds). |
| **Account delete** (Clerk `user.deleted` webhook)                   | User row + cascade (books, pages, assets, orders, notifications).                                                                                       | Every uploaded photo (`user_<dbUserId>/uploads/`), plus all generated content for every book (`storywink/<bookId>/` per book). Includes uploads that never made it into a book.                                                                     |
| **Draft retention sweep** (weekly, inside the asset-cleanup worker) | DRAFT books untouched for `DRAFT_RETENTION_DAYS` (default 90) are deleted (cascade), max 100 per sweep. Non-DRAFT books are never touched, however old. | Same path as a manual book delete, with reason `draft_expired`.                                                                                                                                                                                     |

Ordering is always: collect Cloudinary public ids while the rows still exist, delete the database rows, then enqueue the cleanup job. If collection fails, the request fails **without deleting anything**, so a retry can never leak photos. If the enqueue fails after a successful row delete, the request still succeeds (the user's deletion happened) and an error log flags that Cloudinary content was not removed.

## How deletion runs

The `asset-cleanup` BullMQ queue (workers service, `apps/workers/src/workers/asset-cleanup.worker.ts`) processes jobs shaped `{publicIds, prefixes?, reason, userId?, bookId?}` with 3 attempts and exponential backoff:

- Explicit public ids are deleted via the Cloudinary Admin API in chunks of 100. Per-id `not_found` results are expected (retries, double deletes) and never fail the job.
- Folder prefixes (`storywink/<bookId>/`, `user_<dbUserId>/uploads/`) are purged with `delete_resources_by_prefix`, looping while Cloudinary reports `partial`. A strict shape check refuses any prefix that is not one of those two scoped folder forms, so a bug can never pass an account-wide prefix.
- Every completed deletion writes an `assets_deleted` AppEvent with `{count, notFound, reason}`. Dry runs write `assets_delete_dry_run` instead and log the full target list.

Shared helpers live in `packages/shared/src/cloudinary.ts`: `extractCloudinaryPublicId` (every URL shape the app stores, including HEIC rewrites and derived thumbnails), the shared-asset guard, and sweep candidate selection. All are unit-tested.

## Environment flags (workers service)

| Flag                    | Default | Effect                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ASSET_CLEANUP_ENFORCE` | `false` | **Dry-run by default.** While false, cleanup jobs log exactly what they would delete and write `assets_delete_dry_run` events; the draft sweep only logs candidates and writes one `draft_sweep_candidate` event per book. Set to `true` to actually delete Cloudinary content and let the sweep delete expired draft rows. |
| `DRAFT_RETENTION_DAYS`  | `90`    | Inactivity window (by `updatedAt`) before a DRAFT book qualifies for the sweep. Invalid values fall back to 90.                                                                                                                                                                                                             |

Rollout: deploy with the default (dry-run), audit the worker logs and AppEvents for a week of real deletions and one sweep, then set `ASSET_CLEANUP_ENFORCE=true` on the workers service. The web routes always collect and enqueue; only the worker decides.

## Known limitations

- If a book is deleted while illustration jobs are still running, an upload can land after collection. The `storywink/<bookId>/` prefix purge in the same job catches it in practice, but an upload completing after the purge would persist until the next account-level deletion.
- Orphaned Asset rows (book deleted, asset unshared) stay in the database with dead URLs after enforcement. Nothing reads them; account deletion cascades them away.
- Print-order PDFs submitted to Lulu are governed by Lulu's retention, not this pipeline.

## FAQ wording this backs

`landing.faq5A` promises secure storage and deletion on request. Book delete and account delete are the "on request" paths; the draft sweep bounds how long an abandoned upload can sit. If the FAQ wording changes, keep it inside what this pipeline actually does.
