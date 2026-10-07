/** Takrorlanadigan "tasodifiy" sonlar generatori (mulberry32). */
export function createRng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** [-1, 1] oralig'ida qiymat. */
    signed: () => next() * 2 - 1,
    /** [min, max) oralig'ida qiymat. */
    range: (min: number, max: number) => min + next() * (max - min),
  };
}

export type Rng = ReturnType<typeof createRng>;
