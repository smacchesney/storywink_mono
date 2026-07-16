import { describe, it, expect } from 'vitest';
import { cloudinaryLoader, tinyThumbUrl } from './cloudinary-loader';

const SRC = 'https://res.cloudinary.com/storywink/image/upload/v1234/books/page1.png';

describe('cloudinaryLoader', () => {
  it('inserts one width-limited transform with auto format and quality', () => {
    expect(cloudinaryLoader({ src: SRC, width: 640 })).toBe(
      'https://res.cloudinary.com/storywink/image/upload/f_auto,q_auto,w_640,c_limit/v1234/books/page1.png',
    );
  });

  it('honours an explicit quality', () => {
    expect(cloudinaryLoader({ src: SRC, width: 1080, quality: 75 })).toContain(
      '/upload/f_auto,q_75,w_1080,c_limit/',
    );
  });

  it('passes non-Cloudinary URLs through untouched', () => {
    const other = 'https://via.placeholder.com/300.png';
    expect(cloudinaryLoader({ src: other, width: 640 })).toBe(other);
  });

  it('leaves non-image Cloudinary delivery paths alone', () => {
    const video = 'https://res.cloudinary.com/storywink/video/upload/v1/raw.jpg';
    expect(cloudinaryLoader({ src: video, width: 640 })).toBe(video);
  });
});

describe('tinyThumbUrl', () => {
  it('derives a single tiny variant for the CSS-blurred backdrop', () => {
    expect(tinyThumbUrl(SRC)).toBe(
      'https://res.cloudinary.com/storywink/image/upload/f_auto,q_auto,w_24/v1234/books/page1.png',
    );
  });

  it('passes non-Cloudinary URLs through untouched', () => {
    expect(tinyThumbUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
  });
});
