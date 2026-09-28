// Coverage counts every file under src/, tested or not; the Gate reads coverage/coverage-summary.json.
export default {
  test: {
    include: ['test/**/*.test.mjs'],
    coverage: { provider: 'v8', all: true, include: ['src/**/*.mjs'], reporter: ['text', 'json-summary'], reportsDirectory: 'coverage' },
  },
}
