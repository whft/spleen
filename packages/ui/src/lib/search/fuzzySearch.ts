import Fuse from "fuse.js";

export interface FuzzySearchOptions {
  threshold?: number;
  distance?: number;
  ignoreLocation?: boolean;
  preferSubstring?: boolean;
}

const DEFAULT_FUZZY_OPTIONS: Required<FuzzySearchOptions> = {
  threshold: 0.4,
  distance: 100,
  ignoreLocation: true,
  preferSubstring: true,
};

export function matchesFuzzyQuery(
  target: string,
  query: string,
  options?: FuzzySearchOptions
): boolean {
  if (!query) {
    return true;
  }
  if (!target) {
    return false;
  }

  const mergedOptions = { ...DEFAULT_FUZZY_OPTIONS, ...options };

  if (mergedOptions.preferSubstring && target.toLowerCase().includes(query.toLowerCase())) {
    return true;
  }

  const fuse = new Fuse([target], {
    threshold: mergedOptions.threshold,
    distance: mergedOptions.distance,
    ignoreLocation: mergedOptions.ignoreLocation,
  });

  return fuse.search(query).length > 0;
}

const RANK_TOKEN_MISS = Number.POSITIVE_INFINITY;

const tokenizeRankQuery = (query: string): string[] =>
  query.trim().toLowerCase().split(/\s+/).filter(Boolean);

const compactText = (value: string): string => value.replace(/[^a-z0-9]+/g, '');

const isAsciiAlphaNumCode = (code: number): boolean =>
  (code >= 97 && code <= 122) || (code >= 48 && code <= 57);

type RankFields = { fields: string[]; compact: (string | undefined)[] };

const buildRankFields = (texts: ReadonlyArray<string | null | undefined>): RankFields => {
  const fields: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (!text) continue;
    fields.push(text.toLowerCase());
  }
  return { fields, compact: new Array<string | undefined>(fields.length) };
};

const getCompactField = (rankFields: RankFields, index: number): string => {
  let value = rankFields.compact[index];
  if (value === undefined) {
    value = compactText(rankFields.fields[index]);
    rankFields.compact[index] = value;
  }
  return value;
};

const scoreRankToken = (token: string, compactToken: string, rankFields: RankFields): number => {
  const { fields } = rankFields;
  let best = RANK_TOKEN_MISS;
  for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
    const field = fields[fieldIndex];
    const fieldPenalty = fieldIndex * 0.01;
    const idx = field.indexOf(token);
    let score = RANK_TOKEN_MISS;
    if (idx === 0) {
      score = fieldPenalty;
    } else if (idx > 0) {
      const boundary = !isAsciiAlphaNumCode(field.charCodeAt(idx - 1));
      score = (boundary ? 0.1 : 0.2) + idx / 1000 + fieldPenalty;
    } else if (compactToken.length > 0 && token.length > 1) {
      const compactIdx = getCompactField(rankFields, fieldIndex).indexOf(compactToken);
      if (compactIdx >= 0) {
        score = 0.4 + compactIdx / 1000 + fieldPenalty;
      }
    }
    if (score < best) best = score;
  }
  return best;
};

export interface RankByQueryOptions {
  limit?: number;
  fuzzy?: boolean;
}

export function rankByQuery<T>(
  items: readonly T[],
  query: string,
  getTexts: (item: T) => ReadonlyArray<string | null | undefined>,
  options?: RankByQueryOptions,
): T[] {
  const tokens = tokenizeRankQuery(query);
  const limit = options?.limit ?? items.length;
  if (tokens.length === 0) return items.slice(0, limit);

  const compactTokens = tokens.map(compactText);
  const fuzzyEnabled = options?.fuzzy ?? true;
  const collectMissed = fuzzyEnabled && tokens.length === 1 && tokens[0].length >= 3;
  const scored: { item: T; score: number; order: number }[] = [];
  const missed: { item: T; joined: string; order: number }[] = [];

  for (let order = 0; order < items.length; order++) {
    const item = items[order];
    const rankFields = buildRankFields(getTexts(item));
    let total = 0;
    for (let i = 0; i < tokens.length; i++) {
      const tokenScore = scoreRankToken(tokens[i], compactTokens[i], rankFields);
      if (tokenScore === RANK_TOKEN_MISS) {
        total = RANK_TOKEN_MISS;
        break;
      }
      total += tokenScore;
    }
    if (total === RANK_TOKEN_MISS) {
      if (collectMissed) {
        missed.push({ item, joined: rankFields.fields.join(' '), order });
      }
    } else {
      scored.push({ item, score: total, order });
    }
  }

  if (collectMissed && missed.length > 0) {
    const fuse = new Fuse(
      missed.map((entry) => entry.joined),
      { threshold: 0.35, ignoreLocation: true, distance: 100, includeScore: true, minMatchCharLength: 2 },
    );
    for (const result of fuse.search(tokens[0])) {
      const entry = missed[result.refIndex];
      scored.push({ item: entry.item, score: 1 + (result.score ?? 1), order: entry.order });
    }
  }

  scored.sort((a, b) => (a.score - b.score) || (a.order - b.order));
  return scored.slice(0, limit).map((entry) => entry.item);
}

export function matchesRankQuery(
  texts: ReadonlyArray<string | null | undefined>,
  query: string,
  options?: { wordStart?: boolean },
): boolean {
  const tokens = tokenizeRankQuery(query);
  if (tokens.length === 0) return true;
  const rankFields = buildRankFields(texts);
  if (options?.wordStart) {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (!matchesTokenAtWordStart(token, compactText(token), rankFields)) return false;
    }
    return true;
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (scoreRankToken(token, compactText(token), rankFields) === RANK_TOKEN_MISS) return false;
  }
  return true;
}

export const SIDEBAR_SEARCH = { wordStart: true } as const;

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

const isWordCharAt = (field: string, index: number): boolean => {
  const code = field.charCodeAt(index);
  if (code < 128) return isAsciiAlphaNumCode(code);
  return WORD_CHARACTER.test(field[index]);
};

const startsWithCompact = (field: string, startIndex: number, compactToken: string): boolean => {
  let matched = 0;
  const targetLen = compactToken.length;
  for (let i = startIndex; i < field.length; i += 1) {
    const code = field.charCodeAt(i);
    if (!isAsciiAlphaNumCode(code)) continue;
    if (code !== compactToken.charCodeAt(matched)) return false;
    matched += 1;
    if (matched === targetLen) return true;
  }
  return false;
};

const matchesTokenAtWordStart = (token: string, compactToken: string, { fields }: RankFields): boolean => {
  const allowCompact = token.length > 1 && compactToken.length > 0;
  for (let f = 0; f < fields.length; f += 1) {
    const field = fields[f];
    for (let index = 0; index < field.length; index += 1) {
      if (index > 0 && isWordCharAt(field, index - 1)) continue;
      if (field.startsWith(token, index)) return true;
      if (allowCompact && startsWithCompact(field, index, compactToken)) return true;
    }
  }
  return false;
};

