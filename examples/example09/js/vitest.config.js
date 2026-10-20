export default { test: { include: ['test/**/*.test.js'], coverage: { provider: 'v8', include: ['src/**'], reporter: ['cobertura'], reportsDirectory: 'coverage' } } }
