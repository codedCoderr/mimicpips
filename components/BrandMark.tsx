interface BrandMarkProps {
  label?: string;
  eyebrow?: boolean;
}

export function BrandMark({ label = "Mimic Pips", eyebrow = false }: BrandMarkProps) {
  return (
    <div className="flex items-center gap-2.5">
      <img
        src="/brand/mimic-pips-icon.png"
        alt=""
        aria-hidden="true"
        className="h-7 w-7 object-contain"
      />
      <span className={eyebrow ? "eyebrow" : "font-display font-semibold text-lg"}>
        {label}
      </span>
    </div>
  );
}
