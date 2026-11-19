import { APP_NAME } from "@/lib/brand";

type Props = {
  className?: string;
  title?: string;
};

/** Destello simple: círculo suave + rayo de luz. Sirve en UI y como favicon. */
export function LumenLogo({ className = "size-8", title = APP_NAME }: Props) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <defs>
        <radialGradient id="lumenGlow" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="55%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="28" fill="url(#lumenGlow)" opacity="0.35" />
      <circle cx="32" cy="32" r="14" fill="currentColor" opacity="0.92" />
      <path
        d="M32 8v8M32 48v8M8 32h8M48 32h8M14.5 14.5l5.5 5.5M44 44l5.5 5.5M14.5 49.5l5.5-5.5M44 20l5.5-5.5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
        opacity="0.85"
      />
      <circle cx="32" cy="32" r="5" fill="var(--background, #fff)" opacity="0.95" />
    </svg>
  );
}
