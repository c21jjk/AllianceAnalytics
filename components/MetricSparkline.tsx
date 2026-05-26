import clsx from "clsx";

interface MetricSparklineProps {
  /** Series of values; rendered as a smooth area chart */
  values: number[];
  /** Pixel width (default 120) */
  width?: number;
  /** Pixel height (default 36) */
  height?: number;
  /** CSS color for the line stroke (defaults to gold) */
  stroke?: string;
  /** CSS color for the area fill (defaults to translucent gold) */
  fill?: string;
  className?: string;
  ariaLabel?: string;
}

/**
 * Tiny dependency-free SVG sparkline. Builds an area chart from the values
 * array. Used in the post list rows and on the post detail page.
 */
export default function MetricSparkline({
  values,
  width = 120,
  height = 36,
  stroke = "var(--accent, #C9A84C)",
  fill = "rgba(201, 168, 76, 0.18)",
  className,
  ariaLabel,
}: MetricSparklineProps) {
  if (values.length === 0) {
    return <div className={clsx("h-9", className)} />;
  }

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const padX = 2;
  const padY = 3;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const points = values.map((v, i) => {
    const x =
      values.length === 1 ? width / 2 : padX + (i / (values.length - 1)) * innerW;
    const y = padY + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });

  const linePath = points
    .map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`))
    .join(" ");

  const areaPath = `${linePath} L ${points[points.length - 1][0]} ${
    height - padY
  } L ${points[0][0]} ${height - padY} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={clsx("block", className)}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
    >
      <path d={areaPath} fill={fill} />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
