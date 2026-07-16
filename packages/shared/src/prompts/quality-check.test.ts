import { describe, it, expect } from 'vitest';
import {
  createQCPrompt,
  QC_RESPONSE_SCHEMA,
  QC_CLASSES,
  QC_BLOCKING_CLASSES,
  emptyQcClassFlags,
  type QcPageContext,
} from './quality-check.js';

describe('createQCPrompt (baseline, no sheets or cover)', () => {
  const prompt = createQCPrompt(null, 8);

  it('keeps the page-ordinal labeling contract', () => {
    expect(prompt).toContain('page 1 through page 8');
    expect(prompt).toContain('"PAGE n"');
  });

  it('mentions neither reference sheets nor the cover', () => {
    expect(prompt).not.toContain('REFERENCE SHEET');
    expect(prompt).not.toContain('COVER RUBRIC');
  });
});

describe('createQCPrompt with character sheets', () => {
  const prompt = createQCPrompt(null, 8, 'en', { sheetCount: 2 });

  it('declares the sheets as ground truth with a non-numeric label', () => {
    expect(prompt).toContain('REFERENCE SHEET');
    expect(prompt).toContain('GROUND TRUTH');
  });

  it('excludes the sheets from pageResults', () => {
    expect(prompt).toContain('do NOT include them in "pageResults"');
  });
});

describe('createQCPrompt cover rubric variant', () => {
  const prompt = createQCPrompt(null, 8, 'en', {
    sheetCount: 1,
    cover: { expectedTitle: "Mia's Rainy Day" },
  });

  it('labels the cover with a non-numeric label and routes it to coverResult', () => {
    expect(prompt).toContain('labeled "COVER"');
    expect(prompt).toContain('"coverResult"');
    expect(prompt).toContain('NOT in "pageResults"');
  });

  it('expects the painted title and requires an exact match against the book title', () => {
    expect(prompt).toContain('EXPECTED');
    expect(prompt).toContain(`EXACTLY "Mia's Rainy Day"`);
    expect(prompt).toContain('titleMatches=false');
  });

  it('exempts a correct title from the stray-text cap', () => {
    expect(prompt).toContain('must NOT count as stray text');
    expect(prompt).toContain('must NOT cap the overall score');
  });

  it('still caps other unintended text on the cover', () => {
    expect(prompt).toContain('caps OVERALL QUALITY at 4');
  });

  it('scores cover characters against the reference sheet when sheets are present', () => {
    expect(prompt).toContain('against the REFERENCE SHEET');
  });
});

describe('createQCPrompt cover-only framing (pageCount 0)', () => {
  const prompt = createQCPrompt(null, 0, 'en', {
    sheetCount: 1,
    cover: { expectedTitle: 'Coral' },
  });

  it('drops the interior page-ordinal framing entirely', () => {
    // The Task-1 defect: "these 0 children's book illustrations … page 1 through page 0".
    expect(prompt).not.toContain('these 0');
    expect(prompt).not.toContain('page 1 through page 0');
    expect(prompt).not.toContain('"PAGE n"');
  });

  it('gives the cover its own opening and routes to an empty pageResults', () => {
    expect(prompt).toContain('Evaluate this book cover illustration');
    expect(prompt).toContain('empty "pageResults" array');
  });

  it('still carries the cover rubric variant', () => {
    expect(prompt).toContain('labeled "COVER"');
    expect(prompt).toContain(`EXACTLY "Coral"`);
  });
});

describe('createQCPrompt rendered-text tightening (rubric v2)', () => {
  const prompt = createQCPrompt(null, 8, 'en', {});

  it('drops the onomatopoeia grandfather clause', () => {
    expect(prompt).not.toContain('Intentional onomatopoeia');
    expect(prompt).not.toContain('onomatopoeia sound effects are allowed');
    expect(prompt).not.toContain('correctly spelled');
  });

  it('forbids ANY lettering, sound words included', () => {
    expect(prompt).toContain('NO lettering of ANY kind');
    expect(prompt).toContain('NO exception for sound words');
    expect(prompt).toContain('classFlags.renderedText=true');
    expect(prompt).toContain('cap OVERALL QUALITY at 4');
  });

  it('keeps the anatomy cap', () => {
    expect(prompt).toContain('ANATOMY');
    expect(prompt).toContain('cap OVERALL QUALITY at 5');
  });
});

describe('createQCPrompt per-page defect-class rubric (items 3-8)', () => {
  const prompt = createQCPrompt(null, 8, 'en', {});

  it('names every classFlags dimension', () => {
    for (const cls of QC_CLASSES) {
      expect(prompt).toContain(cls);
    }
  });

  it('describes exact-cast presence and species/kind match with the griffin case', () => {
    expect(prompt).toContain('missingExpectedCast');
    expect(prompt).toContain('speciesMismatch');
    expect(prompt).toContain('griffin');
    expect(prompt).toContain('judge the KIND against the Expected cast species');
  });

  it('describes the whole-creature hybrid case as broader than the anatomy cap', () => {
    expect(prompt).toContain('characterHybrid');
    expect(prompt).toContain('WHOLE-creature case');
  });

  it('makes prop-holder and focal-action null-when-nothing-to-judge', () => {
    expect(prompt).toContain('propHolderMismatch');
    expect(prompt).toContain('focalActionMismatch');
    expect(prompt).toContain('Set null when no Held props line assigns a holder');
    expect(prompt).toContain('Set null when the page has no Story text');
  });
});

describe('createQCPrompt per-page context feed', () => {
  const pageContext: QcPageContext[] = [
    {
      ordinal: 1,
      text: 'Kai splashed into the puddle with a grin.',
      cast: [
        { name: 'Kai', species: 'a young boy' },
        { name: 'Grypho', species: 'a green toy crocodile' },
      ],
      props: ['lantern held by Kai'],
    },
    { ordinal: 2, text: null, cast: [{ name: 'Kai', species: 'a young boy' }] },
  ];
  const prompt = createQCPrompt(null, 2, 'en', { sheetCount: 1, pageContext });

  it('feeds each page its expected cast (real names + species phrases)', () => {
    expect(prompt).toContain('PER-PAGE CONTEXT FEED');
    expect(prompt).toContain('Kai (a young boy)');
    expect(prompt).toContain('Grypho (a green toy crocodile)');
  });

  it('feeds each page its story text and marks empty text', () => {
    expect(prompt).toContain('Kai splashed into the puddle with a grin.');
    expect(prompt).toContain('(no story text on this page)');
  });

  it('feeds holder-annotated props when present', () => {
    expect(prompt).toContain('Held props: lantern held by Kai.');
  });

  it('states the real-names-are-intentional rationale in the feed header', () => {
    expect(prompt).toContain('REAL character names');
    expect(prompt).toContain("judge each named character's APPEARANCE");
  });

  it('omits the context feed section entirely when no page context is supplied', () => {
    const bare = createQCPrompt(null, 2, 'en', { sheetCount: 1 });
    expect(bare).not.toContain('PER-PAGE CONTEXT FEED');
  });

  it('anchors appearance to the sheets when sheets are present', () => {
    expect(prompt).toContain('APPEARANCE against the REFERENCE SHEETS');
  });

  it('anchors appearance to the canonical descriptions when identity exists but no sheets', () => {
    const identity = {
      characters: [
        {
          characterId: 'child_1',
          role: 'main_child',
          name: 'Kai',
          physicalTraits: {
            apparentAge: '6',
            hairColor: 'black',
            hairStyle: 'short',
            skinTone: 'golden-brown',
            bodyBuild: 'small',
            distinguishingFeatures: [],
          },
          typicalClothing: 'red raincoat',
          styleTranslation: 'soft crayon',
          appearsOnPages: [1, 2],
        },
      ],
      sceneContext: 'rainy day',
    };
    const noSheets = createQCPrompt(identity, 2, 'en', { pageContext });
    expect(noSheets).toContain('APPEARANCE against the canonical descriptions below');
  });

  it('does not dangle a canonical-descriptions reference when neither sheets nor identity exist', () => {
    // sheetCount 0 AND null identity: the character section says no reference
    // exists, so the feed header must not point at "descriptions below".
    const bare = createQCPrompt(null, 2, 'en', { pageContext });
    expect(bare).not.toContain('against the canonical descriptions below');
    expect(bare).toContain('APPEARANCE for internal consistency across pages');
  });
});

describe('QC_RESPONSE_SCHEMA coverResult extension', () => {
  it('keeps strict-mode invariants (all properties required, no additionals)', () => {
    expect(QC_RESPONSE_SCHEMA.required).toContain('coverResult');
    expect(QC_RESPONSE_SCHEMA.additionalProperties).toBe(false);
    const cover = QC_RESPONSE_SCHEMA.properties.coverResult;
    expect(cover.type).toEqual(['object', 'null']);
    expect(cover.required).toEqual(Object.keys(cover.properties));
    expect(cover.additionalProperties).toBe(false);
  });

  it('cover result carries the title-match verdict', () => {
    expect(QC_RESPONSE_SCHEMA.properties.coverResult.properties.titleMatches).toEqual({
      type: 'boolean',
    });
  });
});

describe('QC_RESPONSE_SCHEMA classFlags extension (strict-mode-safe)', () => {
  const item = QC_RESPONSE_SCHEMA.properties.pageResults.items;
  const classFlags = item.properties.classFlags;

  it('requires classFlags on every page result', () => {
    expect(item.required).toContain('classFlags');
    expect(item.additionalProperties).toBe(false);
  });

  it('lists exactly the QC_CLASSES keys, all required', () => {
    expect(Object.keys(classFlags.properties)).toEqual([...QC_CLASSES]);
    expect(classFlags.required).toEqual(Object.keys(classFlags.properties));
    expect(classFlags.additionalProperties).toBe(false);
  });

  it('models the two no-op classes as nullable booleans', () => {
    expect(classFlags.properties.propHolderMismatch).toEqual({ type: ['boolean', 'null'] });
    expect(classFlags.properties.focalActionMismatch).toEqual({ type: ['boolean', 'null'] });
  });

  it('models the blocking classes as plain booleans', () => {
    expect(classFlags.properties.renderedText).toEqual({ type: 'boolean' });
    expect(classFlags.properties.intraImageDuplicate).toEqual({ type: 'boolean' });
  });
});

describe('QC class taxonomy + gating constants', () => {
  it('the blocking set is a subset of the full taxonomy', () => {
    for (const cls of QC_BLOCKING_CLASSES) {
      expect(QC_CLASSES).toContain(cls);
    }
  });

  it('day-one blocking is exactly rendered-text + intra-image-duplicate', () => {
    expect([...QC_BLOCKING_CLASSES]).toEqual(['renderedText', 'intraImageDuplicate']);
  });

  it('emptyQcClassFlags is the all-clean / null default (an unjudged page)', () => {
    expect(emptyQcClassFlags()).toEqual({
      renderedText: false,
      intraImageDuplicate: false,
      missingExpectedCast: false,
      speciesMismatch: false,
      characterHybrid: false,
      propHolderMismatch: null,
      focalActionMismatch: null,
    });
  });

  it('emptyQcClassFlags covers every taxonomy key', () => {
    expect(Object.keys(emptyQcClassFlags()).sort()).toEqual([...QC_CLASSES].sort());
  });
});

describe('createQCPrompt bridge-page lines', () => {
  it('is absent when no bridge ordinals are passed (flag-off / photo-only books)', () => {
    const prompt = createQCPrompt(null, 8, 'en', {});
    expect(prompt).not.toContain('WITHOUT a source photo');
    expect(prompt).not.toContain('near-duplicate');
  });

  it('names the bridge pages by their PAGE-n presentation ordinals', () => {
    const prompt = createQCPrompt(null, 8, 'en', { bridgePageOrdinals: [3, 7] });
    expect(prompt).toContain('PAGE 3, PAGE 7');
    expect(prompt).toContain('generated WITHOUT a source photo');
  });

  it('adds the strict-consistency and near-duplicate-composition instructions', () => {
    const prompt = createQCPrompt(null, 8, 'en', { bridgePageOrdinals: [3], sheetCount: 1 });
    expect(prompt).toContain('STRICTLY against the canonical description and the REFERENCE SHEET');
    expect(prompt).toContain('near-duplicate of a neighboring page');
  });
});
