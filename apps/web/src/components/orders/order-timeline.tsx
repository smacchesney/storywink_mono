import { Check } from 'lucide-react';

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
          <li key={label} className="flex-1 flex flex-col items-center relative">
            {/* Connector to the previous step */}
            {i > 0 && (
              <span
                aria-hidden
                className={`absolute top-[13px] right-1/2 w-full h-[3px] rounded-full ${
                  reached ? 'bg-coral' : 'bg-coral-soft'
                }`}
              />
            )}
            <span
              className={`relative z-10 flex items-center justify-center w-7 h-7 rounded-full border-2 ${
                done
                  ? 'bg-coral border-coral text-white'
                  : inProgress
                    ? 'bg-white border-coral'
                    : 'bg-white border-coral-soft'
              }`}
            >
              {done ? (
                <Check className="w-4 h-4" strokeWidth={3} />
              ) : inProgress ? (
                <span className="w-2.5 h-2.5 rounded-full bg-coral animate-pulse" />
              ) : null}
            </span>
            <span
              className={`mt-1.5 text-xs text-center ${
                isCurrent ? 'font-semibold text-ink' : reached ? 'text-ink' : 'text-muted-foreground'
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
