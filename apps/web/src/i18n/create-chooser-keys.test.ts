import { describe, it, expect } from 'vitest';
import en from '../../messages/en.json';
import ja from '../../messages/ja.json';

// Pins the X8 create-chooser copy so a rename or a half-locale edit trips a
// test, not a blank card in prod. backToChooser is Task 1's key — kept here so
// the whole chooser surface is covered in one place.
const CREATE_KEYS = [
  'backToChooser',
  'pathPhotosTitle',
  'pathPhotosBeat1',
  'pathPhotosBeat2',
  'pathPhotosBeat3',
  'pathPhotosChip',
  'pathFriendsTitle',
  'pathFriendsTitleNamed',
  'pathFriendsBeat1',
  'pathFriendsBeat2',
  'pathFriendsBeat3',
  'pathFriendsChip',
  'pathLastTime',
] as const;

describe('create-chooser i18n keys', () => {
  for (const locale of [
    ['en', en],
    ['ja', ja],
  ] as const) {
    const [name, catalog] = locale;
    const create = (catalog as { create: Record<string, string> }).create;

    it.each(CREATE_KEYS)(`${name}: create.%s is present and non-empty`, (key) => {
      expect(typeof create[key]).toBe('string');
      expect(create[key].trim().length).toBeGreaterThan(0);
    });
  }

  it('pathFriendsTitleNamed keeps the {name} placeholder in both locales', () => {
    expect((en.create as Record<string, string>).pathFriendsTitleNamed).toContain('{name}');
    expect((ja.create as Record<string, string>).pathFriendsTitleNamed).toContain('{name}');
  });
});
