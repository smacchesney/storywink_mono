'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { track } from '@/lib/track';
import ReadingRibbon from '@/components/create/setup/ReadingRibbon';
import { Storydust } from '@/components/ui/storydust';
import {
  WIZARD_STEP_COUNT,
  canLeaveStep1,
  deriveStep3State,
  guardStep,
  parseStepParam,
  perceptionQuestionCount,
  skippedSteps,
  type WizardStepId,
} from '@/components/create/setup/wizard-steps';
import StepWho from './steps/StepWho';
import StepDay from './steps/StepDay';
import StepSaw from './steps/StepSaw';
import StepFinish from './steps/StepFinish';
import type { WizardStepProps } from './steps/step-props';

const STEP_TITLE_KEYS: Record<WizardStepId, string> = {
  1: 'stepWhoTitle',
  2: 'stepDayTitle',
  3: 'stepSawTitle',
  4: 'stepFinishTitle',
};

const TRANSITION_MS = 200;

export type SetupWizardProps = Omit<WizardStepProps, 'goToStep'> & {
  /** Deterministic extraction cutoff — called synchronously before entering
   * step 4 (and again from submit); the page aborts in-flight ramble
   * extraction and blocks new ones. */
  onReachFinish: () => void;
  /** Step-1 Next with an empty name → the page flips showNameError. */
  onNameErrorRequest: () => void;
  summaryEdited: boolean;
};

export function SetupWizard(props: SetupWizardProps) {
  const {
    form,
    photoPending,
    stripPhase,
    reReading,
    photos,
    bookId,
    discoveryChips,
    roster,
    onReachFinish,
  } = props;
  const t = useTranslations('setup');
  const reducedMotion = useReducedMotion() ?? false;

  // Parent only mounts this after the client-side book load, so window is
  // always available in the initializer.
  const [step, setStep] = React.useState<WizardStepId>(() =>
    guardStep(parseStepParam(window.location.search), form.childName),
  );
  // 1 forward slide, -1 back slide, 0 crossfade (recap jumps / pops).
  const [direction, setDirection] = React.useState<1 | -1 | 0>(1);
  const visited = React.useRef(new Set<WizardStepId>([step]));
  const interacted = React.useRef(new Set<WizardStepId>());
  const viewed = React.useRef(new Set<WizardStepId>());
  const navLock = React.useRef(false);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  const lockNav = () => {
    if (navLock.current) return false;
    navLock.current = true;
    setTimeout(() => {
      navLock.current = false;
    }, TRANSITION_MS + 100);
    return true;
  };

  const blurActive = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  // Canonicalize the entry URL once, replacing so Back still exits the flow.
  React.useEffect(() => {
    window.history.replaceState({ winkStep: step }, '', `?step=${step}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // System back/forward → step change; guards canonicalize via replace.
  React.useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const raw =
        typeof e.state?.winkStep === 'number'
          ? e.state.winkStep
          : parseStepParam(window.location.search);
      // Untagged pop on this pathname (edge: user meddled with the URL):
      // guard and canonicalize rather than guessing.
      let target = guardStep(raw, form.childName);
      // Forward-pop into a photo-gated step while mutations are in flight:
      // bounce back to step 2 (canonicalized, no new entry).
      if (target > 2 && step === 2 && photoPending > 0) target = 2;
      if (target !== raw || typeof e.state?.winkStep !== 'number') {
        window.history.replaceState({ winkStep: target }, '', `?step=${target}`);
      }
      if (target === 4) onReachFinish();
      blurActive();
      setDirection(0);
      setStep(target);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [form.childName, step, photoPending, onReachFinish]);

  // Per-step: telemetry (deduped), focus, scroll. (Cutoff runs in goToStep.)
  React.useEffect(() => {
    visited.current.add(step);
    if (!viewed.current.has(step)) {
      viewed.current.add(step);
      track('setup_step_viewed', { ...(bookId ? { bookId } : {}), props: { step } });
    }
    window.scrollTo({ top: 0 });
    const id = setTimeout(() => headingRef.current?.focus(), TRANSITION_MS + 50);
    return () => clearTimeout(id);
  }, [step, bookId]);

  // setup_step3_transition — observed at SHELL level so it fires even when
  // perception resolves while the parent is on steps 1-2, and exactly once.
  const step3 = deriveStep3State(
    stripPhase,
    {
      rosterCount: roster.length,
      chipCount: discoveryChips.length,
      themeLine: form.themeLine,
      perceptionQuestionCount: perceptionQuestionCount(form.captureQuestions),
    },
    reReading,
  );
  const sawReading = React.useRef(step3 === 'reading');
  const transitionReported = React.useRef(false);
  React.useEffect(() => {
    if (step3 === 'reading') {
      sawReading.current = true;
      return;
    }
    if (sawReading.current && !transitionReported.current) {
      transitionReported.current = true;
      track('setup_step3_transition', {
        ...(bookId ? { bookId } : {}),
        props: { to: step3 },
      });
    }
  }, [step3, bookId]);

  const goToStep = React.useCallback(
    (target: WizardStepId, source: 'next' | 'recap') => {
      if (target === step) return;
      if (target > 1 && !canLeaveStep1(form.childName)) return;
      // Forward past the photo step is gated on in-flight mutations,
      // wherever the navigation came from (Next button or recap jump).
      if (target > 2 && step <= 2 && photoPending > 0) return;
      if (!lockNav()) return;
      if (target === 4) onReachFinish(); // synchronous, BEFORE history/state
      blurActive();
      setDirection(source === 'next' ? (target > step ? 1 : -1) : 0);
      // User navigations always PUSH: pushState truncates forward entries,
      // so back-then-next can't corrupt the stack, and recap jumps are
      // Back-able (see wizard-steps history-model tests).
      window.history.pushState({ winkStep: target }, '', `?step=${target}`);
      setStep(target);
    },
    [step, form.childName, photoPending, onReachFinish],
  );

  const handleNext = () => {
    if (step === 1 && !canLeaveStep1(form.childName)) {
      props.onNameErrorRequest();
      return;
    }
    if (step === 2 && photoPending > 0) return;
    if (step < WIZARD_STEP_COUNT) goToStep((step + 1) as WizardStepId, 'next');
  };

  const handleBack = () => {
    if (!lockNav()) return;
    window.history.back(); // past step 1 this exits the flow via real history
  };

  const handleSubmit = () => {
    track('setup_submitted', {
      ...(bookId ? { bookId } : {}),
      props: {
        reviewFirst: form.reviewFirst,
        chipsAnswered: form.captureQuestions.filter((q) => q.answer && q.answer !== '__skip__')
          .length,
        ...(form.tone ? { tone: form.tone } : {}),
        stripPhaseAtSubmit: stripPhase,
        summaryEdited: props.summaryEdited,
        wizard: true,
        skippedSteps: skippedSteps(visited.current, interacted.current),
        step3State: step3,
      },
    });
    props.onSubmit();
  };

  const markInteracted = () => interacted.current.add(step);

  // Steps see interaction-marking wrappers around every user-action callback
  // (photo edits and star picks count as interaction, not just typing).
  const stepProps: WizardStepProps = {
    ...props,
    onChange: (key, value) => {
      markInteracted();
      props.onChange(key, value);
    },
    onReorder: (next) => {
      markInteracted();
      props.onReorder(next);
    },
    onPhotosChanged: () => {
      markInteracted();
      return props.onPhotosChanged?.();
    },
    onPickStar: (c) => {
      markInteracted();
      props.onPickStar(c);
    },
    onPickEveryone: () => {
      markInteracted();
      props.onPickEveryone();
    },
    onSubmit: handleSubmit,
    goToStep,
  };

  const nextDisabled = step === 2 && photoPending > 0;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-4 pb-10">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={t('back')}
          onClick={handleBack}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={WIZARD_STEP_COUNT}
          aria-valuenow={step}
          aria-label={t('progressLabel', {
            n: step,
            total: WIZARD_STEP_COUNT,
            title: t(STEP_TITLE_KEYS[step]),
          })}
          className="flex flex-1 gap-1.5"
        >
          {([1, 2, 3, 4] as WizardStepId[]).map((s) => (
            <span
              key={s}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors duration-300',
                s <= step ? 'bg-coral' : 'bg-black/10',
              )}
            />
          ))}
        </div>
      </div>

      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-playful text-2xl text-[#1a1a1a] outline-none"
      >
        {t(STEP_TITLE_KEYS[step])}
      </h1>

      {step <= 2 && stripPhase !== 'hidden' && <ReadingRibbon phase={stripPhase} photos={photos} />}

      <div className="relative overflow-x-clip">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={
              reducedMotion || direction === 0
                ? { opacity: 0 }
                : { opacity: 0, x: direction === 1 ? 32 : -32 }
            }
            animate={{ opacity: 1, x: 0 }}
            exit={
              reducedMotion || direction === 0
                ? { opacity: 0 }
                : { opacity: 0, x: direction === 1 ? -32 : 32 }
            }
            transition={{ duration: TRANSITION_MS / 1000, ease: 'easeOut' }}
          >
            {step === 1 && <StepWho {...stepProps} />}
            {step === 2 && <StepDay {...stepProps} />}
            {step === 3 && <StepSaw {...stepProps} />}
            {step === 4 && <StepFinish {...stepProps} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {step < WIZARD_STEP_COUNT && (
        <button
          type="button"
          onClick={handleNext}
          disabled={nextDisabled}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-coral px-6 py-3.5 font-playful text-lg text-white shadow-md transition-colors hover:bg-coral/90 disabled:opacity-70"
        >
          {nextDisabled ? (
            <>
              <Storydust variant="twinkle" size="inline" className="text-white" />
              {t('waitingForPhotos')}
            </>
          ) : (
            t('next')
          )}
        </button>
      )}
    </div>
  );
}

export default SetupWizard;
