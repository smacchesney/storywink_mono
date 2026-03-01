import { optimizeCloudinaryUrl } from '@storywink/shared';

/**
 * Lightweight page type matching the fields FlipbookViewer accesses.
 * Cast to Page when passing to FlipbookViewer.
 */
export interface ExampleBookPage {
  id: string;
  pageNumber: number;
  isTitlePage: boolean;
  generatedImageUrl: string | null;
  text: string | null;
}

export interface ExampleBook {
  id: string;
  title: string;
  childName: string;
  coverAlt: string;
  bookPages: ExampleBookPage[];
}

// Book: "Kai at Universal" (cmm6imevk000xmy0du8ozmjos)
const KAI_AT_UNIVERSAL_PAGES: ExampleBookPage[] = [
  {
    id: 'kai-p1',
    pageNumber: 1,
    isTitlePage: true,
    generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295126/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_1.png',
    text: null,
  },
  {
    id: 'kai-p2',
    pageNumber: 2,
    isTitlePage: false,
    generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295101/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_2.png',
    text: 'Kai climbs into the dark ride with Dada. Click, click, the bar goes down. Kai holds on tight. \u201cReady, Dada?\u201d he says. The car goes\u2026 RUMBLE, RATTLE, ROLL!',
  },
  {
    id: 'kai-p3',
    pageNumber: 3,
    isTitlePage: false,
    generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295111/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_3.png',
    text: 'Outside, rain goes drip-drop, drip-drop. Kai in his raincoat sees big costume people. Kai looks up, up, up. They look down, down, down. Everyone smiles.',
  },
  {
    id: 'kai-p4',
    pageNumber: 4,
    isTitlePage: false,
    generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295160/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_4.png',
    text: 'Click! A big group picture! Kai stands in the middle with Mama and Dada. The brave show people make strong muscles. Kai makes tiny strong muscles too. Grrr!',
  },
  {
    id: 'kai-p5',
    pageNumber: 5,
    isTitlePage: false,
    generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295162/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_5.png',
    text: 'Inside, Kai sees a giant dinosaur skeleton. Its teeth look chompy-chomp-chomp! Kai\u2019s mouth makes a big O. \u201cROAR!\u201d he says. The restaurant echoes back, \u201cRoooar\u2026\u201d',
  },
  {
    id: 'kai-p6',
    pageNumber: 6,
    isTitlePage: false,
    generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295209/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_6.png',
    text: 'Kai finds a silly monster game. The monster\u2019s mouth is full of bright balls. \u201cChomp chomp, I\u2019m hungry!\u201d Kai says in a monster voice and rolls another ball inside.',
  },
  {
    id: 'kai-p7',
    pageNumber: 7,
    isTitlePage: false,
    generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295219/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_7.png',
    text: 'Now Kai stands by a huge colorful cannon. He pushes the handle with both hands. \u201cBoom?\u201d he whispers. \u201cBOOM!\u201d he shouts, giggling.',
  },
  {
    id: 'kai-p8',
    pageNumber: 8,
    isTitlePage: false,
    generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295208/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_8.png',
    text: 'Round and round the ride goes. Kai and Mama sit together in the orange car. \u201cUp, please!\u201d Kai calls. The floor shakes, \u201cclack-clack-clack.\u201d',
  },
  {
    id: 'kai-p9',
    pageNumber: 9,
    isTitlePage: false,
    generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295271/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_9.png',
    text: 'WHOOSH! The flying cups lift into the air. Purple, orange, and green zoom past. Kai feels his tummy wiggle and laughs, \u201cWheee!\u201d',
  },
  {
    id: 'kai-p10',
    pageNumber: 10,
    isTitlePage: false,
    generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295270/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_10.png',
    text: 'Kai sits on a giant red chair. His feet don\u2019t touch the floor! Presents peek out of big boxes beside him. \u201cIs this Santa\u2019s chair?\u201d he whispers.',
  },
  {
    id: 'kai-p11',
    pageNumber: 11,
    isTitlePage: false,
    generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295272/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_11.png',
    text: 'Robots are everywhere! Kai walks past the big metal building and looks up, up, up. A huge yellow robot guards the sign. Kai hugs his toy tight.',
  },
  {
    id: 'kai-p12',
    pageNumber: 12,
    isTitlePage: false,
    generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295316/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_12.png',
    text: 'Red lights flash. A giant robot steps out. \u201cStomp, stomp,\u201d goes the floor. Kai holds Mama\u2019s arm but keeps watching. His eyes say, \u201cWow.\u201d',
  },
  {
    id: 'kai-p13',
    pageNumber: 13,
    isTitlePage: false,
    generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295314/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_13.png',
    text: 'Now it\u2019s picture time with the huge robot. Mama holds Kai. Dada reaches in close. The robot stands behind them, clangy and strong. Kai feels brave in the middle.',
  },
  {
    id: 'kai-p14',
    pageNumber: 14,
    isTitlePage: false,
    generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295327/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_14.png',
    text: 'Night lights turn the street purple and green. Kai eats cold, sweet ice cream by the bright red truck. Lick, lick, lick\u2026 what a yummy end to his Universal day.',
  },
];

// TODO: Add real data for books 2 & 3 — currently duplicates of book 1 with different titles
export const EXAMPLE_BOOKS: ExampleBook[] = [
  {
    id: 'example-kai',
    title: 'Kai at Universal',
    childName: 'Kai',
    coverAlt: 'A personalized storybook about Kai at Universal Studios',
    bookPages: KAI_AT_UNIVERSAL_PAGES,
  },
  {
    id: 'example-book-2',
    title: "Max's Magic Paintbrush",
    childName: 'Max',
    coverAlt: 'A personalized storybook about Max',
    bookPages: KAI_AT_UNIVERSAL_PAGES, // TODO: Replace with real book 2 pages
  },
  {
    id: 'example-book-3',
    title: "Aria's Space Journey",
    childName: 'Aria',
    coverAlt: 'A personalized storybook about Aria',
    bookPages: KAI_AT_UNIVERSAL_PAGES, // TODO: Replace with real book 3 pages
  },
];

/**
 * Get the cover image URL for an example book (title page illustration).
 */
export function getCoverUrl(book: ExampleBook): string {
  const titlePage = book.bookPages.find((p) => p.isTitlePage);
  const url = titlePage?.generatedImageUrl || book.bookPages[0]?.generatedImageUrl;
  if (!url) return '';
  return optimizeCloudinaryUrl(url, { additionalTransforms: 'w_400' }) || url;
}
