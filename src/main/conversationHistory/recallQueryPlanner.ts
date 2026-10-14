const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const TOKEN_PATTERN = /[\p{L}\p{N}_]+/gu;
const MEMORY_INTENT_PATTERN =
  /(?:记得|记忆|之前|以前|上次|历史|曾经|当前.{0,6}(?:项目|偏好|决定)|(?:项目|偏好|决定).{0,4}(?:是什么|有哪些)|还记得|what did we|do you remember|previous(?:ly)?|last time|memory|memories)/iu;
const STOP_WORDS = new Set([
  '的',
  '了',
  '是',
  '在',
  '和',
  '与',
  '或',
  '吗',
  '呢',
  '吧',
  '我',
  '你',
  '我们',
  '这个',
  '那个',
  '什么',
  '一下',
  '当前',
  '请',
  '帮我',
  'about',
  'did',
  'do',
  'the',
  'what',
]);

interface SegmentData {
  segment: string;
  isWordLike?: boolean;
}

interface SegmenterLike {
  segment(input: string): Iterable<SegmentData>;
}

interface SegmenterConstructor {
  new (locales?: string | string[], options?: { granularity?: string }): SegmenterLike;
}

export interface RecallQueryPlan {
  exactQuery: string;
  broadQuery: string | null;
  explicitMemoryIntent: boolean;
}

export function planRecallQuery(query: string): RecallQueryPlan {
  const exactQuery = query.trim();
  const broadQuery = CJK_PATTERN.test(exactQuery) ? buildBroadQuery(exactQuery) : null;
  return {
    exactQuery,
    broadQuery:
      broadQuery && normalizeForComparison(broadQuery) !== normalizeForComparison(exactQuery)
        ? broadQuery
        : null,
    explicitMemoryIntent: MEMORY_INTENT_PATTERN.test(exactQuery),
  };
}

function buildBroadQuery(query: string): string | null {
  const segmenterConstructor = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor })
    .Segmenter;
  const rawSegments = segmenterConstructor
    ? [...new segmenterConstructor(['zh', 'ja', 'ko'], { granularity: 'word' }).segment(query)]
        .filter(item => item.isWordLike !== false)
        .map(item => item.segment)
    : (query.match(TOKEN_PATTERN) ?? []);
  const terms = rawSegments
    .flatMap((segment): string[] => [...(segment.match(TOKEN_PATTERN) ?? [])])
    .map(segment => segment.toLocaleLowerCase())
    .filter(segment => segment.length > 0 && !STOP_WORDS.has(segment));
  const uniqueTerms = [...new Set(terms)];
  return uniqueTerms.length > 0 ? uniqueTerms.join(' ') : null;
}

function normalizeForComparison(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '');
}
