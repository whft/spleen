export const LINEAR_URL_CASES: ReadonlyArray<readonly [url: string, identifier: string | null]> = [
  ['https://linear.app/spleen/issue/ENG-12', 'ENG-12'],
  ['https://linear.app/spleen/issue/eng-12/broken-login', 'ENG-12'],
  ['https://www.linear.app/spleen/issue/OPE-282?foo=1#c', 'OPE-282'],
  ['http://LINEAR.app/spleen/issue/a1-7/', 'A1-7'],
  ['https://linear.app/issue/ENG-12', null],
  ['https://linear.app/spleen/project/ENG-12', null],
  ['https://linear.app/spleen/issue/12', null],
  ['https://linear.app.evil.test/spleen/issue/ENG-12', null],
  ['https://example.com/spleen/issue/ENG-12', null],
  ['linear://spleen/issue/ENG-12', null],
  ['ENG-12', null],
  ['', null],
];
