/**
 * Pure text logic for turning Google Meet's live caption blocks into stable transcript turns.
 *
 * Meet keeps one caption block per continuous stretch of speech. While the person talks, the
 * block's text is rewritten in place: words are appended, the last few words get revised, and in
 * long monologues the oldest lines are trimmed off the front. `mergeCaptionText` folds each new
 * observation of a block into the full text accumulated so far, so nothing is lost or duplicated.
 */

export const normalizeCaption = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Merge a fresh observation of a caption block into the text accumulated for that block.
 * @param full       everything accumulated so far for this block
 * @param observed   the block's current on-screen text
 * @param committed  length of `full` already emitted as final turns; that prefix is never rewritten
 */
export function mergeCaptionText(full: string, observed: string, committed = 0): string {
  const obs = normalizeCaption(observed);
  if (!obs) return full;
  if (!full) return obs;
  if (full === obs || full.endsWith(obs)) return full;

  // Find where the observed text starts inside what we already have. Try a long anchor first,
  // then shorter ones, so a revised tail ("going to" -> "gonna") still lines up.
  let at = -1;
  for (const len of [40, 24, 12, 6]) {
    if (obs.length < len && len !== 6) continue;
    const anchor = obs.slice(0, Math.min(len, obs.length));
    at = full.lastIndexOf(anchor);
    if (at !== -1) break;
  }

  if (at === -1) {
    // Short captions get fully rewritten early on ("Hi" -> "Hello there"): replace the uncommitted tail.
    const tail = full.slice(committed);
    if (tail.length < 24 && obs.length < 48 && committed === 0) return obs;
    // Otherwise the block moved on with no overlap; append.
    return `${full} ${obs}`;
  }

  if (at >= committed) return full.slice(0, at) + obs;

  // The overlap starts inside text we already emitted: keep the committed part untouched and
  // only take what the observation adds beyond it.
  const extra = obs.slice(committed - at);
  return full.slice(0, committed) + extra;
}
