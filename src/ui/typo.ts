// Slovak typesetting: a one-letter preposition or conjunction (v, z, k, s, o, u, a, i)
// must not end a line, so it is glued to the next word with a no-break space.
const ONE_LETTER = /(^|[\s(„"])([vzksouaiVZKSOUAI]) +/g;

export function tie(text: string): string {
  // Run twice so that chains like "a v meste" are fully tied.
  return text.replace(ONE_LETTER, "$1$2 ").replace(ONE_LETTER, "$1$2 ");
}
