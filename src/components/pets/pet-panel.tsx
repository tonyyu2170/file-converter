export function PetPanel() {
  return (
    <div
      className="pointer-events-none absolute right-6 top-6 hidden h-[240px] w-[400px] xl:block"
      data-testid="pet-panel"
      aria-hidden="true"
    >
      <picture>
        <source srcSet="/pets/akita_static.png" media="(prefers-reduced-motion: reduce)" />
        <img
          src="/pets/akita_walk_8fps.gif"
          alt=""
          width={87}
          height={57}
          className="pet-stroll absolute bottom-0 left-0 [image-rendering:pixelated]"
        />
      </picture>
    </div>
  );
}
