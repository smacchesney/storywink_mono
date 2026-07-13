/**
 * X8: /create is the fork. With NEXT_PUBLIC_AVATARS_ENABLED on, it renders the
 * two-path chooser (photos vs characters); off, it renders the photo flow
 * directly, exactly as before. The photo path itself lives at /create/photos.
 */

import { PhotoBookCreate } from '@/components/create/PhotoBookCreate';
import { CreatePathChooser } from '@/components/create/CreatePathChooser';

export default function CreateBookPage() {
  if (process.env.NEXT_PUBLIC_AVATARS_ENABLED === 'true') {
    return <CreatePathChooser />;
  }
  return <PhotoBookCreate />;
}
