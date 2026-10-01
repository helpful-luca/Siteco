import { cn } from './cn';

type Country = 'de' | 'us';

/** Five-point star with radius 1 around the origin, for the US canton. */
const STAR = Array.from({ length: 10 }, (_, index) => {
  const angle = (Math.PI / 5) * index - Math.PI / 2;
  const radius = index % 2 === 0 ? 1 : 0.382;
  return `${(Math.cos(angle) * radius).toFixed(3)},${(Math.sin(angle) * radius).toFixed(3)}`;
}).join(' ');

/** The 50 star centres: nine rows, alternating six and five (canton 0.76 x 0.5385 of the fly). */
const US_STARS = Array.from({ length: 9 }, (_, row) =>
  Array.from({ length: row % 2 === 0 ? 6 : 5 }, (_, column) => ({
    x: 0.063 * (2 * column + (row % 2 === 0 ? 1 : 2)),
    y: 0.054 * (row + 1),
  })),
).flat();

function Germany() {
  return (
    <>
      <rect width="30" height="20" fill="#000000" />
      <rect y="6.667" width="30" height="6.667" fill="#dd0000" />
      <rect y="13.333" width="30" height="6.667" fill="#ffce00" />
    </>
  );
}

/** Proportions per the US flag specification (1 : 1.9), scaled to a height of 20. */
function UnitedStates() {
  const stripe = 20 / 13;
  return (
    <>
      <rect width="38" height="20" fill="#ffffff" />
      {Array.from({ length: 7 }, (_, index) => (
        <rect key={index} y={index * 2 * stripe} width="38" height={stripe} fill="#b31942" />
      ))}
      <rect width="15.2" height={stripe * 7} fill="#0a3161" />
      {US_STARS.map(({ x, y }) => (
        <polygon key={`${x}-${y}`} points={STAR} fill="#ffffff" transform={`translate(${x * 20} ${y * 20}) scale(0.616)`} />
      ))}
    </>
  );
}

/**
 * A small flag in a 3 : 2 frame with rounded corners and a hairline edge. Decorative: the
 * language name next to it carries the meaning.
 */
export function Flag({ country, className }: { country: Country; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-block aspect-[3/2] h-6 overflow-hidden rounded-[5px] after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-black/10 after:ring-inset dark:after:ring-white/15',
        className,
      )}
    >
      <svg
        viewBox={country === 'de' ? '0 0 30 20' : '0 0 38 20'}
        preserveAspectRatio="xMinYMid slice"
        className="block size-full"
        focusable="false"
      >
        {country === 'de' ? <Germany /> : <UnitedStates />}
      </svg>
    </span>
  );
}
