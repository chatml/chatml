/**
 * Simple fuzzy subsequence matcher.
 * Returns whether the query matches the text, and the character index ranges
 * that matched (for highlighting).
 */
export function fuzzyMatch(
  query: string,
  text: string,
): { matched: boolean; ranges: [number, number][] } {
  if (!query) return { matched: true, ranges: [] };

  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();
  const ranges: [number, number][] = [];
  let qi = 0;
  let rangeStart = -1;

  for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti++) {
    if (lowerText[ti] === lowerQuery[qi]) {
      if (rangeStart === -1) rangeStart = ti;
      qi++;
    } else {
      if (rangeStart !== -1) {
        ranges.push([rangeStart, ti]);
        rangeStart = -1;
      }
    }
  }

  // Close any open range
  if (rangeStart !== -1 && qi === lowerQuery.length) {
    // Find the end of the last matched character
    let lastMatchIndex = 0;
    let tmpQi = 0;
    for (let ti = 0; ti < lowerText.length && tmpQi < lowerQuery.length; ti++) {
      if (lowerText[ti] === lowerQuery[tmpQi]) {
        lastMatchIndex = ti;
        tmpQi++;
      }
    }
    ranges.push([rangeStart, lastMatchIndex + 1]);
  }

  return { matched: qi === lowerQuery.length, ranges };
}
