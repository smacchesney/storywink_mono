import { cn } from "@/lib/utils";

interface ScallopEdgeProps {
  /** When true the scallops point up (use above a footer). Default points down (below a header). */
  flip?: boolean;
  /** Fill colour of the scalloped band. Defaults to white. */
  fill?: string;
  /** Stroke colour of the scallop line. Defaults to brand coral. */
  stroke?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * A mathematically seamless scalloped cloud edge.
 *
 * One repeating tile holds a single symmetric bump built from two cubic
 * beziers. The control handles are vertical at every tile boundary, so the
 * curve is tangent-continuous where tiles meet — no visible seams and every
 * bump is the same width and height at any viewport size.
 */
export function ScallopEdge({
  flip = false,
  fill = "white",
  stroke = "var(--coral-primary)",
  className,
  style,
}: ScallopEdgeProps) {
  // Wider, softer bumps read as clouds; the previous 44px tile felt like
  // ric-rac trim at desktop widths.
  const W = 72; // bump width
  const H = 20; // scallop depth
  const PAD = 4; // vertical breathing room so the 2px stroke never clips
  const height = H + PAD;

  // Valleys sit at y = PAD (near the flat body edge); peaks dip to y = PAD + H.
  // Vertical control handles at each valley give tangent continuity across tiles.
  const k = W * 0.36; // handle length — tuned for a soft, round bump
  const top = PAD;
  const bot = PAD + H;
  // Fill path: flat top edge + one scallop bump, closed.
  const fillPath = `M0,0 L0,${top} C${k},${top} ${W / 2 - k},${bot} ${W / 2},${bot} C${W / 2 + k},${bot} ${W - k},${top} ${W},${top} L${W},0 Z`;
  // Stroke path: just the scallop curve (no top/side edges).
  const strokePath = `M0,${top} C${k},${top} ${W / 2 - k},${bot} ${W / 2},${bot} C${W / 2 + k},${bot} ${W - k},${top} ${W},${top}`;

  return (
    <svg
      className={cn("pointer-events-none block w-full", className)}
      width="100%"
      height={height}
      style={{ ...(flip ? { transform: "scaleY(-1)" } : {}), ...style }}
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={`scallop-${flip ? "up" : "down"}`}
          x="0"
          y="0"
          width={W}
          height={height}
          patternUnits="userSpaceOnUse"
        >
          <path d={fillPath} fill={fill} />
          <path
            d={strokePath}
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </pattern>
      </defs>
      <rect width="100%" height={height} fill={`url(#scallop-${flip ? "up" : "down"})`} />
    </svg>
  );
}
