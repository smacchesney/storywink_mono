import { describe, it, expect } from 'vitest';
import {
  extractCloudinaryPublicId,
  extractCharacterReferenceUrls,
  collectBookGeneratedPublicIds,
  bookGeneratedFolderPrefix,
  userUploadsFolderPrefix,
  isSafeCloudinaryPrefix,
  excludeSharedAssetIds,
  deletableStagedAssetIds,
  isDraftSweepCandidate,
  assetCleanupJobSchema,
  chunkPublicIds,
  collectAvatarGeneratedPublicIds,
} from './cloudinary.js';

const CLOUD = 'https://res.cloudinary.com/demo';

describe('extractCloudinaryPublicId', () => {
  // -- URL shapes the codebase actually stores --------------------------------

  it('extracts from a plain upload response URL (originals via /api/upload)', () => {
    expect(
      extractCloudinaryPublicId(
        `${CLOUD}/image/upload/v1712345678/user_cm9xka1/uploads/abc123.jpg`,
      ),
    ).toBe('user_cm9xka1/uploads/abc123');
  });

  it('extracts from a generated illustration URL (worker upload_stream)', () => {
    expect(
      extractCloudinaryPublicId(
        `${CLOUD}/image/upload/v1712345678/storywink/cm9book1/generated/xyz789.png`,
      ),
    ).toBe('storywink/cm9book1/generated/xyz789');
  });

  it('extracts from a character sheet URL (storywink/<bookId>/refs)', () => {
    expect(
      extractCloudinaryPublicId(
        `${CLOUD}/image/upload/v1712345678/storywink/cm9book1/refs/sheet1.png`,
      ),
    ).toBe('storywink/cm9book1/refs/sheet1');
  });

  it('extracts from a HEIC delivery rewrite (convertHeicToJpeg output)', () => {
    expect(
      extractCloudinaryPublicId(
        `${CLOUD}/image/upload/f_jpg,fl_force_strip/v1712345678/user_cm9xka1/uploads/img42.heic`,
      ),
    ).toBe('user_cm9xka1/uploads/img42');
  });

  it('extracts from a derived thumbnail URL (deriveThumbnailUrl output)', () => {
    expect(
      extractCloudinaryPublicId(
        `${CLOUD}/image/upload/c_limit,w_400,q_auto/v1712345678/user_cm9xka1/uploads/abc123.jpg`,
      ),
    ).toBe('user_cm9xka1/uploads/abc123');
  });

  it('extracts from a vision-optimized URL (optimizeCloudinaryUrlForVision output)', () => {
    expect(
      extractCloudinaryPublicId(
        `${CLOUD}/image/upload/c_limit,w_2048,h_2048,q_auto/v1712345678/storywink/cm9book1/generated/p1.png`,
      ),
    ).toBe('storywink/cm9book1/generated/p1');
  });

  it('extracts from an f_auto,q_auto optimized URL (optimizeCloudinaryUrl output)', () => {
    expect(
      extractCloudinaryPublicId(
        `${CLOUD}/image/upload/f_auto,q_auto/v1712345678/storywink/cm9book1/generated/p1.png`,
      ),
    ).toBe('storywink/cm9book1/generated/p1');
  });

  // -- structural variants -----------------------------------------------------

  it('handles a single comma-free transformation segment', () => {
    expect(
      extractCloudinaryPublicId(
        `${CLOUD}/image/upload/f_jpg/v1712345678/user_cm9xka1/uploads/a.heic`,
      ),
    ).toBe('user_cm9xka1/uploads/a');
  });

  it('handles chained transformation groups', () => {
    expect(
      extractCloudinaryPublicId(
        `${CLOUD}/image/upload/c_fill,w_200,h_200/e_grayscale/v99/folder/img.jpg`,
      ),
    ).toBe('folder/img');
  });

  it('handles unversioned URLs with folders', () => {
    expect(extractCloudinaryPublicId(`${CLOUD}/image/upload/user_cm9xka1/uploads/abc.jpg`)).toBe(
      'user_cm9xka1/uploads/abc',
    );
  });

  it('does not mistake a user_<id> folder for a transformation (no version marker)', () => {
    // "user_" has 4 chars before the underscore — must NOT be stripped.
    expect(extractCloudinaryPublicId(`${CLOUD}/image/upload/user_abc123/uploads/pic.jpg`)).toBe(
      'user_abc123/uploads/pic',
    );
  });

  it('handles a bare public id with no folder and no version', () => {
    expect(extractCloudinaryPublicId(`${CLOUD}/image/upload/sample.jpg`)).toBe('sample');
  });

  it('handles a versioned public id with no folder', () => {
    expect(extractCloudinaryPublicId(`${CLOUD}/image/upload/v1571218330/sample.jpg`)).toBe(
      'sample',
    );
  });

  it('does not treat a folder named like a version as the version marker twice', () => {
    expect(extractCloudinaryPublicId(`${CLOUD}/image/upload/v123/v456/img.jpg`)).toBe('v456/img');
  });

  it('keeps URLs without an extension intact', () => {
    expect(
      extractCloudinaryPublicId(`${CLOUD}/image/upload/v1712345678/user_cm9xka1/uploads/abc123`),
    ).toBe('user_cm9xka1/uploads/abc123');
  });

  it('strips query strings and fragments', () => {
    expect(
      extractCloudinaryPublicId(
        `${CLOUD}/image/upload/v1712345678/user_cm9xka1/uploads/abc.jpg?_a=BAMADKRgA0#top`,
      ),
    ).toBe('user_cm9xka1/uploads/abc');
  });

  it('decodes URL-encoded characters in the public id', () => {
    expect(
      extractCloudinaryPublicId(`${CLOUD}/image/upload/v1712345678/folder/my%20photo.jpg`),
    ).toBe('folder/my photo');
  });

  it('supports private and authenticated delivery types', () => {
    expect(extractCloudinaryPublicId(`${CLOUD}/image/private/v123/folder/img.jpg`)).toBe(
      'folder/img',
    );
    expect(extractCloudinaryPublicId(`${CLOUD}/image/authenticated/v123/folder/img.jpg`)).toBe(
      'folder/img',
    );
  });

  it('keeps the extension for raw resources (part of the public id)', () => {
    expect(extractCloudinaryPublicId(`${CLOUD}/raw/upload/v123/docs/book.pdf`)).toBe(
      'docs/book.pdf',
    );
  });

  it('extracts video public ids', () => {
    expect(extractCloudinaryPublicId(`${CLOUD}/video/upload/v123/clips/intro.mp4`)).toBe(
      'clips/intro',
    );
  });

  // -- rejections ---------------------------------------------------------------

  it('returns null for fetch delivery URLs (remote content, not ours)', () => {
    expect(
      extractCloudinaryPublicId(`${CLOUD}/image/fetch/v123/https://example.com/img.jpg`),
    ).toBeNull();
  });

  it('returns null for non-Cloudinary URLs', () => {
    expect(extractCloudinaryPublicId('https://example.com/image/upload/v123/a.jpg')).toBeNull();
    expect(extractCloudinaryPublicId('https://img.clerk.com/abc123')).toBeNull();
    expect(
      extractCloudinaryPublicId('https://evilcloudinary.com/demo/image/upload/v123/a.jpg'),
    ).toBeNull();
  });

  it('returns null for non-URL and empty inputs', () => {
    expect(extractCloudinaryPublicId(null)).toBeNull();
    expect(extractCloudinaryPublicId(undefined)).toBeNull();
    expect(extractCloudinaryPublicId('')).toBeNull();
    expect(extractCloudinaryPublicId('   ')).toBeNull();
    expect(extractCloudinaryPublicId('not-a-url')).toBeNull();
    expect(
      extractCloudinaryPublicId('ftp://res.cloudinary.com/demo/image/upload/v1/a.jpg'),
    ).toBeNull();
  });

  it('returns null for unknown resource types and too-short paths', () => {
    expect(extractCloudinaryPublicId(`${CLOUD}/documents/upload/v123/a.jpg`)).toBeNull();
    expect(extractCloudinaryPublicId('https://res.cloudinary.com/demo/image/upload')).toBeNull();
  });
});

describe('extractCharacterReferenceUrls', () => {
  it('reads urls from well-formed sheet entries', () => {
    const json = [
      {
        characterId: 'char_1',
        artStyle: 'vignette',
        url: `${CLOUD}/image/upload/v1/storywink/b/refs/s1.png`,
        validatedAt: '2026-01-01',
      },
      {
        characterId: 'char_2',
        artStyle: 'vignette',
        url: `${CLOUD}/image/upload/v1/storywink/b/refs/s2.png`,
        validatedAt: '2026-01-01',
      },
    ];
    expect(extractCharacterReferenceUrls(json)).toHaveLength(2);
  });

  it('ignores malformed entries and non-array json', () => {
    expect(extractCharacterReferenceUrls(null)).toEqual([]);
    expect(extractCharacterReferenceUrls({})).toEqual([]);
    expect(extractCharacterReferenceUrls([{ url: 42 }, null, 'x', { noUrl: true }])).toEqual([]);
  });
});

describe('collectBookGeneratedPublicIds', () => {
  it('collects page illustrations, cover, and sheets, deduped, skipping nulls', () => {
    const book = {
      pages: [
        { generatedImageUrl: `${CLOUD}/image/upload/v1/storywink/bk1/generated/p1.png` },
        { generatedImageUrl: `${CLOUD}/image/upload/v1/storywink/bk1/generated/p2.png` },
        { generatedImageUrl: null }, // failed page
        { generatedImageUrl: `${CLOUD}/image/upload/v1/storywink/bk1/generated/p1.png` }, // dup
      ],
      coverImageUrl: `${CLOUD}/image/upload/v1/storywink/bk1/generated/cover.png`,
      characterReferences: [
        {
          characterId: 'c1',
          artStyle: 'vignette',
          url: `${CLOUD}/image/upload/v1/storywink/bk1/refs/s1.png`,
          validatedAt: 'x',
        },
      ],
    };
    expect(collectBookGeneratedPublicIds(book).sort()).toEqual([
      'storywink/bk1/generated/cover',
      'storywink/bk1/generated/p1',
      'storywink/bk1/generated/p2',
      'storywink/bk1/refs/s1',
    ]);
  });

  it('returns empty for a book with nothing generated', () => {
    expect(
      collectBookGeneratedPublicIds({ pages: [], coverImageUrl: null, characterReferences: null }),
    ).toEqual([]);
  });
});

describe('prefix helpers', () => {
  it('builds and validates the two app folder shapes', () => {
    expect(isSafeCloudinaryPrefix(bookGeneratedFolderPrefix('cm9book12345'))).toBe(true);
    expect(isSafeCloudinaryPrefix(userUploadsFolderPrefix('cm9user12345'))).toBe(true);
  });

  it('rejects unscoped or malformed prefixes (mass-deletion guard)', () => {
    expect(isSafeCloudinaryPrefix('storywink/')).toBe(false);
    expect(isSafeCloudinaryPrefix('user_/uploads/')).toBe(false);
    expect(isSafeCloudinaryPrefix('user_ab/uploads/')).toBe(false); // id too short
    expect(isSafeCloudinaryPrefix('storywink/cm9book12345')).toBe(false); // no trailing slash
    expect(isSafeCloudinaryPrefix('')).toBe(false);
    expect(isSafeCloudinaryPrefix('samples/')).toBe(false);
    expect(isSafeCloudinaryPrefix('storywink/../other/')).toBe(false);
  });
});

describe('excludeSharedAssetIds (shared-asset guard)', () => {
  it('removes assets referenced by another book', () => {
    expect(excludeSharedAssetIds(['a1', 'a2', 'a3'], ['a2'])).toEqual(['a1', 'a3']);
  });

  it('dedupes candidates and drops null/undefined/empty entries', () => {
    expect(excludeSharedAssetIds(['a1', 'a1', null, undefined, ''], [])).toEqual(['a1']);
  });

  it('ignores null-ish external references', () => {
    expect(excludeSharedAssetIds(['a1'], [null, undefined, ''])).toEqual(['a1']);
  });

  it('returns empty when every candidate is shared', () => {
    expect(excludeSharedAssetIds(['a1', 'a2'], ['a1', 'a2', 'a9'])).toEqual([]);
  });
});

describe('deletableStagedAssetIds (staged-photo reaper guard)', () => {
  // Every reference KIND must pin its asset independently — dropping any one
  // from the union means deleting a parent's photos under a live record.
  it('spares an asset referenced only by a book page', () => {
    expect(
      deletableStagedAssetIds(['a1', 'a2'], {
        pageAssetIds: ['a1'],
        coverAssetIds: [],
        avatarAssetIds: [],
      }),
    ).toEqual(['a2']);
  });

  it('spares an asset referenced only by a book cover', () => {
    expect(
      deletableStagedAssetIds(['a1', 'a2'], {
        pageAssetIds: [],
        coverAssetIds: ['a2'],
        avatarAssetIds: [],
      }),
    ).toEqual(['a1']);
  });

  it('spares an asset referenced only by an avatar (created or staging)', () => {
    expect(
      deletableStagedAssetIds(['a1', 'a2'], {
        pageAssetIds: [],
        coverAssetIds: [],
        avatarAssetIds: ['a1'],
      }),
    ).toEqual(['a2']);
  });

  it('an unreferenced asset is deletable; duplicates and null-ish refs are handled', () => {
    expect(
      deletableStagedAssetIds(['a1', 'a1', null, undefined], {
        pageAssetIds: [null],
        coverAssetIds: [undefined],
        avatarAssetIds: [''],
      }),
    ).toEqual(['a1']);
  });
});

describe('isDraftSweepCandidate', () => {
  const now = new Date('2026-07-05T00:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  it('flags a DRAFT older than the retention window', () => {
    expect(isDraftSweepCandidate({ status: 'DRAFT', updatedAt: daysAgo(91) }, now, 90)).toBe(true);
  });

  it('does not flag a DRAFT inside the retention window', () => {
    expect(isDraftSweepCandidate({ status: 'DRAFT', updatedAt: daysAgo(89) }, now, 90)).toBe(false);
    expect(isDraftSweepCandidate({ status: 'DRAFT', updatedAt: daysAgo(90) }, now, 90)).toBe(false);
  });

  it('never flags non-DRAFT books, however old', () => {
    for (const status of [
      'GENERATING',
      'ILLUSTRATING',
      'COMPLETED',
      'PARTIAL',
      'FAILED',
      'STORY_READY',
    ]) {
      expect(isDraftSweepCandidate({ status, updatedAt: daysAgo(400) }, now, 90)).toBe(false);
    }
  });

  it('refuses nonsensical retention windows', () => {
    expect(isDraftSweepCandidate({ status: 'DRAFT', updatedAt: daysAgo(400) }, now, 0)).toBe(false);
    expect(isDraftSweepCandidate({ status: 'DRAFT', updatedAt: daysAgo(400) }, now, -5)).toBe(
      false,
    );
    expect(isDraftSweepCandidate({ status: 'DRAFT', updatedAt: daysAgo(400) }, now, NaN)).toBe(
      false,
    );
  });
});

describe('assetCleanupJobSchema', () => {
  it('accepts a well-formed payload', () => {
    const parsed = assetCleanupJobSchema.safeParse({
      publicIds: ['user_x/uploads/a', 'storywink/b/generated/c'],
      prefixes: ['storywink/cm9book12345/'],
      reason: 'book_deleted',
      userId: 'cm9user1',
      bookId: 'cm9book1',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown reasons and malformed ids', () => {
    expect(assetCleanupJobSchema.safeParse({ publicIds: ['a'], reason: 'because' }).success).toBe(
      false,
    );
    expect(
      assetCleanupJobSchema.safeParse({ publicIds: [''], reason: 'book_deleted' }).success,
    ).toBe(false);
    expect(assetCleanupJobSchema.safeParse({ reason: 'book_deleted' }).success).toBe(false);
  });
});

describe('chunkPublicIds', () => {
  it('splits into batches of the given size', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    const chunks = chunkPublicIds(ids, 100);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunks.flat()).toEqual(ids);
  });

  it('returns no chunks for an empty list', () => {
    expect(chunkPublicIds([], 100)).toEqual([]);
  });

  it('throws on a non-positive size', () => {
    expect(() => chunkPublicIds(['a'], 0)).toThrow();
    expect(() => chunkPublicIds(['a'], -1)).toThrow();
  });
});

describe('avatar folder safety (X6)', () => {
  it('accepts a scoped avatar prefix', () => {
    expect(isSafeCloudinaryPrefix('storywink/avatars/clx123abc456/')).toBe(true);
  });

  it('rejects the bare avatars folder — it is not a book id', () => {
    expect(isSafeCloudinaryPrefix('storywink/avatars/')).toBe(false);
  });

  it('still accepts book and upload prefixes', () => {
    expect(isSafeCloudinaryPrefix('storywink/clbook1234567/')).toBe(true);
    expect(isSafeCloudinaryPrefix('user_cluser1234567/uploads/')).toBe(true);
  });

  it('collects rendition public ids', () => {
    expect(
      collectAvatarGeneratedPublicIds([
        {
          turnaroundSheetUrl:
            'https://res.cloudinary.com/storywink/image/upload/v1/storywink/avatars/av1/sheet.png',
          portraitUrl:
            'https://res.cloudinary.com/storywink/image/upload/v1/storywink/avatars/av1/portrait.png',
        },
        { turnaroundSheetUrl: null, portraitUrl: null },
      ]),
    ).toEqual(['storywink/avatars/av1/sheet', 'storywink/avatars/av1/portrait']);
  });

  it('collects both cutout variants from a transparent cutout URL', () => {
    expect(
      collectAvatarGeneratedPublicIds([
        {
          turnaroundSheetUrl: null,
          portraitUrl: null,
          cutoutUrl:
            'https://res.cloudinary.com/storywink/image/upload/v1/storywink/avatars/av1/cutout_vignette_t.png',
        },
      ]),
    ).toEqual(['storywink/avatars/av1/cutout_vignette_t', 'storywink/avatars/av1/cutout_vignette']);
  });

  it('collects both cutout variants from a white-fallback cutout URL', () => {
    expect(
      collectAvatarGeneratedPublicIds([
        {
          turnaroundSheetUrl: null,
          portraitUrl: null,
          cutoutUrl:
            'https://res.cloudinary.com/storywink/image/upload/v1/storywink/avatars/av1/cutout_vignette.png',
        },
      ]),
    ).toEqual(['storywink/avatars/av1/cutout_vignette', 'storywink/avatars/av1/cutout_vignette_t']);
  });
});
