import Image from "next/image";

interface BrandMarkProps {
  label?: string;
  eyebrow?: boolean;
}

export function BrandMark ( { label = "Mimic Pips", eyebrow = false }: BrandMarkProps ) {
  return (
    <div className="flex items-center gap-2.5">
      <Image
        src="/brand/mimic-pips-icon.png"
        alt="Mimic Pips Icon"
        width={ 56 }
        height={ 56 }
        priority
      />
      <span className={ eyebrow ? "eyebrow" : "font-display font-semibold text-lg" }>
        { label }
      </span>
    </div>
  );
}
