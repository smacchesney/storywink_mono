import { Check } from 'lucide-react';
import { SPARK4 } from '@/components/ui/storydust-geometry';

export type OrderTimelineStep = 1 | 2 | 3;

interface OrderTimelineProps {
  /** Highest step reached: 1 Confirmed, 2 Printing, 3 Shipped. */
  currentStep: OrderTimelineStep;
  labels: {
    confirmed: string;
    printing: string;
    shipped: string;
  };
}

/**
 * Three-step order journey: Confirmed → Printing → Shipped. Lulu's lifecycle
 * ends at SHIPPED, so there is deliberately no Delivered step — a permanently
 * grey final dot would only manufacture "is something wrong?" worry.
 *
 * Confirmed and Shipped are events (checked once reached); Printing is a
 * process, shown as a pulsing dot while it is the current step.
 */
export function OrderTimeline({ currentStep, labels }: OrderTimelineProps) {
  const steps = [labels.confirmed, labels.printing, labels.shipped];

  return (
    <ol className="flex items-start">
      {steps.map((label, i) => {
        const stepNumber = i + 1;
        const reached = stepNumber <= currentStep;
        const isCurrent = stepNumber === currentStep;
        // Printing (step 2) is only "done" once the order has moved past it.
        const done = stepNumber < currentStep || (isCurrent && stepNumber !== 2);
        const inProgress = isCurrent && stepNumber === 2;

        return (
          <li key={label} className="relative flex flex-1 flex-col items-center">
            {/* Connector to the previous step */}
            {i > 0 && (
              <span
                aria-hidden
                className={`absolute top-[13px] right-1/2 h-[3px] w-full rounded-full ${
                  reached ? 'bg-coral' : 'bg-coral-soft'
                }`}
              />
            )}
            <span
              className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 ${
                done
                  ? 'border-coral bg-coral text-white'
                  : inProgress
                    ? 'border-coral bg-white'
                    : 'border-coral-soft bg-white'
              }`}
            >
              {done ? (
                <Check className="h-4 w-4" strokeWidth={3} />
              ) : inProgress ? (
                // The printing step is live work — it gets the brand twinkle,
                // not a generic pulsing dot. Reduced motion stills it globally.
                <svg
                  viewBox="0 0 24 24"
                  width={14}
                  height={14}
                  fill="var(--coral-primary)"
                  aria-hidden="true"
                  className="wink-twinkle-star"
                >
                  <path d={SPARK4} />
                </svg>
              ) : null}
            </span>
            <span
              className={`mt-1.5 text-center text-xs ${
                isCurrent
                  ? 'font-semibold text-ink'
                  : reached
                    ? 'text-ink'
                    : 'text-muted-foreground'
              }`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
