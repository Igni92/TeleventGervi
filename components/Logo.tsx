/**
 * Identité Gervi — logo officiel (goutte magenta + carré plié).
 *
 * Rendu depuis `/logo-mark.png` (version transparente, cadrée, ~28 Ko) plutôt
 * que le source `LogoSansFond.png` (1024², 1,3 Mo) pour ne pas alourdir chaque
 * écran. `withWordmark` accole le mot-repère « Gervi ».
 */
export function Logo({
  className,
  withWordmark = false,
}: {
  className?: string;
  withWordmark?: boolean;
}) {
  const mark = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo-mark.png" alt="" className="h-full w-full object-contain" draggable={false} />
  );

  if (!withWordmark) {
    return (
      <span className={`inline-flex ${className ?? ""}`} aria-label="Gervi" role="img">
        {mark}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-2.5 select-none ${className ?? ""}`}
      aria-label="Gervi"
      role="img"
    >
      <span className="inline-flex h-[30px] w-[30px] shrink-0">{mark}</span>
      <span
        aria-hidden
        className="text-[19px] font-bold tracking-[-0.02em] leading-none"
      >
        Gerv<span className="text-brand-500">i</span>
      </span>
    </span>
  );
}
