import type { MatchRange } from './matchSegments';


const SCORE_MATCH = 16;
const GAP_START = -3;
const GAP_EXTENSION = -1;
const BONUS_AFTER_WHITESPACE = 10;
const BONUS_AFTER_DELIMITER = 9;
const BONUS_AFTER_PUNCTUATION = 8;
const BONUS_CAMEL = 7;
const BONUS_CONSECUTIVE = -(GAP_START + GAP_EXTENSION);
const FIRST_LETTER_MULTIPLIER = 2;

const CharClass = { Whitespace: 0, Delimiter: 1, Punctuation: 2, Lower: 3, Upper: 4, Digit: 5 } as const;
type CharClass = (typeof CharClass)[keyof typeof CharClass];

const classifyChar = (char: string): CharClass => {
  if (char === '/' || char === '\\') return CharClass.Delimiter;
  if (char >= '0' && char <= '9') return CharClass.Digit;
  if (char !== char.toLowerCase()) return CharClass.Upper;
  if (char !== char.toUpperCase()) return CharClass.Lower;
  return char.trim() === '' ? CharClass.Whitespace : CharClass.Punctuation;
};

const classifyAt = (text: string, index: number): CharClass => {
  const code = text.charCodeAt(index);
  if (code < 128) {
    if (code >= 97 && code <= 122) return CharClass.Lower;
    if (code >= 65 && code <= 90) return CharClass.Upper;
    if (code >= 48 && code <= 57) return CharClass.Digit;
    if (code === 47 || code === 92) return CharClass.Delimiter;
    if (code === 32 || (code >= 9 && code <= 13)) return CharClass.Whitespace;
    return CharClass.Punctuation;
  }
  return classifyChar(text[index]);
};

const positionBonuses = (text: string): Int8Array => {
  const len = text.length;
  const bonuses = new Int8Array(len);
  let previous: CharClass = CharClass.Whitespace;
  let current: CharClass = len > 0 ? classifyAt(text, 0) : CharClass.Whitespace;
  for (let index = 0; index < len; index++) {
    const next: CharClass = index + 1 < len ? classifyAt(text, index + 1) : CharClass.Whitespace;
    const isLetterOrDigit = current >= CharClass.Lower;
    if (isLetterOrDigit && previous === CharClass.Whitespace) bonuses[index] = BONUS_AFTER_WHITESPACE;
    else if (isLetterOrDigit && previous === CharClass.Delimiter) bonuses[index] = BONUS_AFTER_DELIMITER;
    else if (isLetterOrDigit && previous === CharClass.Punctuation) bonuses[index] = BONUS_AFTER_PUNCTUATION;
    else if (current === CharClass.Upper && previous === CharClass.Lower) bonuses[index] = BONUS_CAMEL;
    else if (current === CharClass.Digit && (previous === CharClass.Lower || previous === CharClass.Upper)) bonuses[index] = BONUS_CAMEL;
    else if (current === CharClass.Upper && previous === CharClass.Upper && index + 1 < len
      && next === CharClass.Lower) bonuses[index] = BONUS_CAMEL;
    else if (current === CharClass.Punctuation) bonuses[index] = BONUS_AFTER_PUNCTUATION;
    previous = current;
    current = next;
  }
  return bonuses;
};

const lowerPerPosition = (text: string): string => {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;
  let result = '';
  for (const char of text) {
    const lowered = char.toLowerCase();
    result += lowered.length === char.length ? lowered : char;
  }
  return result;
};

type Prepared = { lower: string; bonuses: Int8Array };

type TokenMatch = { score: number; positions: number[] };

const isSubsequence = (lower: string, token: string): boolean => {
  let at = 0;
  for (let i = 0; i < token.length; i++) {
    at = lower.indexOf(token[i], at);
    if (at < 0) return false;
    at += 1;
  }
  return true;
};

const MAX_POOLED_DP_CELLS = 65_536;
let dpScoresPool = new Float64Array(0);
let dpRunBonusesPool = new Int8Array(0);
let dpPreviousAtPool = new Int32Array(0);

const acquireDpBuffers = (cells: number) => {
  if (cells <= MAX_POOLED_DP_CELLS) {
    if (dpScoresPool.length < cells) {
      const nextSize = Math.min(MAX_POOLED_DP_CELLS, Math.max(256, cells * 2));
      dpScoresPool = new Float64Array(nextSize);
      dpRunBonusesPool = new Int8Array(nextSize);
      dpPreviousAtPool = new Int32Array(nextSize);
    }
    dpScoresPool.fill(Number.NEGATIVE_INFINITY, 0, cells);
    dpRunBonusesPool.fill(0, 0, cells);
    dpPreviousAtPool.fill(-1, 0, cells);
    return { scores: dpScoresPool, runBonuses: dpRunBonusesPool, previousAt: dpPreviousAtPool };
  }
  return {
    scores: new Float64Array(cells).fill(Number.NEGATIVE_INFINITY),
    runBonuses: new Int8Array(cells),
    previousAt: new Int32Array(cells).fill(-1),
  };
};

const alignToken = ({ lower, bonuses }: Prepared, token: string): TokenMatch | null => {
  const m = token.length;
  const n = lower.length;
  const { scores, runBonuses, previousAt } = acquireDpBuffers(m * n);

  const firstChar = token.charCodeAt(0);
  for (let j = 0; j < n; j++) {
    if (lower.charCodeAt(j) === firstChar && bonuses[j] >= BONUS_CAMEL) {
      scores[j] = SCORE_MATCH + bonuses[j] * FIRST_LETTER_MULTIPLIER;
      runBonuses[j] = bonuses[j];
    }
  }

  for (let i = 1; i < m; i++) {
    const row = i * n;
    const previousRow = row - n;
    const tokenChar = token.charCodeAt(i);
    let gapBest = Number.NEGATIVE_INFINITY;
    let gapBestAt = -1;
    for (let j = i; j < n; j++) {
      if (j >= 2) {
        const fromFurther = gapBest + GAP_EXTENSION;
        const fromAdjacentGap = scores[previousRow + j - 2] + GAP_START;
        if (fromAdjacentGap >= fromFurther) {
          gapBest = fromAdjacentGap;
          gapBestAt = j - 2;
        } else {
          gapBest = fromFurther;
        }
      }
      if (lower.charCodeAt(j) !== tokenChar) continue;
      const bonus = bonuses[j];
      const viaGap = gapBest + SCORE_MATCH + bonus;
      const consecutive = scores[previousRow + j - 1];
      const prevRun = runBonuses[previousRow + j - 1];
      const runBonus = prevRun >= BONUS_CONSECUTIVE
        ? (prevRun >= bonus ? prevRun : bonus)
        : (BONUS_CONSECUTIVE >= bonus ? BONUS_CONSECUTIVE : bonus);
      const viaRun = consecutive + SCORE_MATCH + runBonus;
      if (viaRun >= viaGap && viaRun > Number.NEGATIVE_INFINITY) {
        scores[row + j] = viaRun;
        runBonuses[row + j] = runBonus;
        previousAt[row + j] = j - 1;
      } else if (viaGap > Number.NEGATIVE_INFINITY) {
        scores[row + j] = viaGap;
        runBonuses[row + j] = bonus;
        previousAt[row + j] = gapBestAt;
      }
    }
  }

  const lastRow = (m - 1) * n;
  let bestAt = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let j = m - 1; j < n; j++) {
    const candidate = scores[lastRow + j];
    if (candidate > bestScore) {
      bestScore = candidate;
      bestAt = j;
    }
  }
  if (bestAt < 0) return null;

  const positions = new Array<number>(m);
  for (let i = m - 1, at = bestAt; i >= 0; i--) {
    positions[i] = at;
    at = previousAt[i * n + at];
  }
  return { score: bestScore, positions };
};

const substringToken = ({ lower, bonuses }: Prepared, token: string): TokenMatch | null => {
  const at = lower.indexOf(token);
  if (at < 0) return null;
  const firstBonus = bonuses[at];
  const len = token.length;
  const score = SCORE_MATCH * len + firstBonus * FIRST_LETTER_MULTIPLIER
    + (len - 1) * Math.max(firstBonus, BONUS_CONSECUTIVE);
  const positions = new Array<number>(len);
  for (let offset = 0; offset < len; offset++) {
    positions[offset] = at + offset;
  }
  return { score, positions };
};

const matchToken = (prepared: Prepared, token: string): TokenMatch | null => {
  const unbroken = substringToken(prepared, token);
  if (unbroken && unbroken.score === perfectTokenScore(token.length)) return unbroken;
  const aligned = alignToken(prepared, token);
  if (!aligned) return unbroken;
  if (!unbroken) return aligned;
  return unbroken.score > aligned.score ? unbroken : aligned;
};

const perfectTokenScore = (length: number): number => (
  SCORE_MATCH * length + BONUS_AFTER_WHITESPACE * FIRST_LETTER_MULTIPLIER + (length - 1) * BONUS_AFTER_WHITESPACE
);

const sortedToRanges = (positions: readonly number[]): MatchRange[] => {
  const ranges: [number, number][] = [];
  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];
    const last = ranges[ranges.length - 1];
    if (last && last[1] === position) last[1] = position + 1;
    else if (!last || position > last[1]) ranges.push([position, position + 1]);
  }
  return ranges;
};

const toRanges = (positions: number[]): MatchRange[] => {
  const sorted = [...new Set(positions)].sort((a, b) => a - b);
  return sortedToRanges(sorted);
};

const tokenize = (query: string): string[] => query.trim().toLowerCase().split(/\s+/).filter(Boolean);

type SubsequenceMatch = {
  score: number;
  ranges: MatchRange[];
};

const matchTokens = (text: string, tokens: string[]): SubsequenceMatch | null => {
  if (!text) return null;
  const lower = lowerPerPosition(text);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.length > lower.length || !isSubsequence(lower, token)) return null;
  }
  const prepared: Prepared = { lower, bonuses: positionBonuses(text) };
  if (tokens.length === 1) {
    const match = matchToken(prepared, tokens[0]);
    if (!match) return null;
    return {
      score: Math.min(1, match.score / perfectTokenScore(tokens[0].length)),
      ranges: sortedToRanges(match.positions),
    };
  }
  let total = 0;
  let perfect = 0;
  const positions: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const match = matchToken(prepared, token);
    if (!match) return null;
    total += match.score;
    perfect += perfectTokenScore(token.length);
    for (let j = 0; j < match.positions.length; j++) {
      positions.push(match.positions[j]);
    }
  }
  return { score: Math.min(1, total / perfect), ranges: toRanges(positions) };
};

const lastSegmentStart = (path: string): number => {
  const end = path.endsWith('/') ? path.length - 1 : path.length;
  return path.lastIndexOf('/', end - 1) + 1;
};

const matchPathTokens = (path: string, tokens: string[]): SubsequenceMatch | null => {
  if (!tokens.some((token) => token.includes('/'))) {
    const start = lastSegmentStart(path);
    const end = path.endsWith('/') ? path.length - 1 : path.length;
    const inName = matchTokens(path.slice(start, end), tokens);
    if (inName) {
      return {
        score: 0.5 + inName.score / 2,
        ranges: inName.ranges.map(([rangeStart, rangeEnd]): MatchRange => [rangeStart + start, rangeEnd + start]),
      };
    }
  }
  const inPath = matchTokens(path, tokens);
  return inPath ? { score: inPath.score / 2, ranges: inPath.ranges } : null;
};

export type RankedMatch<T> = { item: T; score: number; ranges: MatchRange[] };

export function rankBySubsequence<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string,
  options?: {
    limit?: number;
    paths?: boolean;
  },
): RankedMatch<T>[] {
  const limit = options?.limit ?? items.length;
  const tokens = tokenize(query);
  if (tokens.length === 0) return items.slice(0, limit).map((item) => ({ item, score: 1, ranges: [] }));

  const ranked: (RankedMatch<T> & { length: number; order: number })[] = [];
  for (let order = 0; order < items.length; order++) {
    const item = items[order];
    const text = getText(item);
    const match = options?.paths ? matchPathTokens(text, tokens) : matchTokens(text, tokens);
    if (match) ranked.push({ item, ...match, length: text.length, order });
  }
  ranked.sort((a, b) => (b.score - a.score) || (a.length - b.length) || (a.order - b.order));
  return ranked.slice(0, limit).map(({ item, score, ranges }) => ({ item, score, ranges }));
}
