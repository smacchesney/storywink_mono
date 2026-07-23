import type { SetupFormState } from '@/components/create/setup/SetupSheet';
import type { StripPhoto } from '@/components/create/setup/PhotoStrip';
import type { StripPhase } from '@/components/create/setup/strip-phase';
import type {
  DiscoveryChip,
  RosterCharacterLike,
} from '@/components/create/setup/discovery-feed';
import type { WizardStepId } from '@/components/create/setup/wizard-steps';

/** Everything a wizard step can touch. The page owns all of it (same object
 * graph SetupSheet receives) — steps are pure presentation over it. */
export interface WizardStepProps {
  form: SetupFormState;
  photos: StripPhoto[];
  prefilledName?: string | null;
  titlePending: boolean;
  stripPhase: StripPhase;
  /** True while a photo-mutation re-read window is open (Task 11). */
  reReading: boolean;
  isSubmitting: boolean;
  showNameError: boolean;
  bookId?: string;
  /** Legacy drafts resumed under the flag can still have a photo cover. */
  coverAssetId: string | null;
  discoveryChips: DiscoveryChip[];
  roster: RosterCharacterLike[];
  pages: Array<{
    assetId: string | null;
    asset?: { url: string | null; thumbnailUrl: string | null } | null;
  }>;
  recurringKidCount: number;
  ensembleAllowed: boolean;
  /** Page-owned count of in-flight photo mutations (uploads/removes/reorder). */
  photoPending: number;
  onChange: <K extends keyof SetupFormState>(key: K, value: SetupFormState[K]) => void;
  onReorder: (photos: StripPhoto[]) => void;
  onPhotosChanged?: () => void | Promise<void>;
  onPhotoPendingDelta: (delta: 1 | -1) => void;
  onPickStar: (character: RosterCharacterLike) => void;
  onPickEveryone: () => void;
  onRambleBlur?: () => void;
  onSubmit: () => void;
  goToStep: (step: WizardStepId, source: 'next' | 'recap') => void;
}
