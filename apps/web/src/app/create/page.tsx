/**
 * X8-C1: /create renders the photo-first flow directly for now. The two-path
 * chooser (photos vs characters) lands in a later task; until then both flag
 * states see the same photo page they always have, so nothing regresses.
 */

import { PhotoBookCreate } from '@/components/create/PhotoBookCreate';

export default function CreateBookPage() {
  return <PhotoBookCreate />;
}
