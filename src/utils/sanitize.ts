/**
 * Metadata sanitization utilities for AnalogAir.
 * Strips remastering tags, mastering credits, edition suffixes, and extraneous technical notes.
 */

export function sanitizeAlbumTitle(title: string): string {
  if (!title) return '';
  let cleaned = title;

  const patterns = [
    // Parenthetical or bracketed notes containing remaster, edition, mix, anniversary, or mastering credits
    /\s*[\(\[][^()\[\]]*(?:re-?master|remix|edition|version|soundtrack|anniversary|deluxe|expanded|legacy|bonus\s+track|mastered\s+by|master\s+by|half-speed)[^()\[\]]*(?:[\)\]]|$)/gi,
    // Hyphenated suffixes
    /\s*-\s*.*?(?:re-?master|mastered\s+by|deluxe|anniversary).*$/gi,
    /\s*-\s*(?:single|ep)\s*$/gi,
    /\s*[\(\[]\s*(?:single|ep)\s*[\)\]]$/gi,
  ];

  for (const pat of patterns) {
    cleaned = cleaned.replace(pat, '');
  }

  cleaned = cleaned.replace(/^[ \t\-–—()\[\]]+|[ \t\-–—()\[\]]+$/g, '').trim();
  return cleaned || title;
}

export function sanitizeTrackTitle(title: string): string {
  if (!title) return '';
  let cleaned = title;

  const patterns = [
    /\s*[\(\[][^()\[\]]*(?:re-?master|remix|edition|version|soundtrack|anniversary|deluxe|expanded|legacy|bonus\s+track|mastered\s+by|master\s+by|half-speed)[^()\[\]]*(?:[\)\]]|$)/gi,
    /\s*-\s*.*?(?:re-?master|mastered\s+by|deluxe|anniversary).*$/gi,
  ];

  for (const pat of patterns) {
    cleaned = cleaned.replace(pat, '');
  }

  cleaned = cleaned.replace(/^[ \t\-–—()\[\]]+|[ \t\-–—()\[\]]+$/g, '').trim();
  return cleaned || title;
}
