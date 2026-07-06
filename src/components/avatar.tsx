// Spec 008: shared avatar (extracted at its 2nd consumer — board table and
// creator header). Paints as a background image; a URL that could break out
// of the CSS url() context (quotes, parens, whitespace) is treated as missing
// and the handle's initial renders instead. Decorative — the accessible name
// lives on the adjacent handle text.

const SAFE_IMAGE_URL = /^https?:\/\/[^\s"'()\\]+$/;

type AvatarProps = {
  url: string | null;
  label: string;
  // size + type scale only; the structural classes stay fixed
  className?: string;
};

export function Avatar({
  url,
  label,
  className = "h-8 w-8 text-sm",
}: AvatarProps) {
  const safeUrl = url !== null && SAFE_IMAGE_URL.test(url) ? url : null;
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 bg-cover bg-center text-foreground/70 ${className}`}
      style={
        safeUrl === null ? undefined : { backgroundImage: `url("${safeUrl}")` }
      }
    >
      {safeUrl === null
        ? label.replace(/^@/, "").charAt(0).toUpperCase()
        : null}
    </span>
  );
}
