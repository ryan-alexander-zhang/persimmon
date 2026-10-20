export default { testDir: 'e2e', reporter: [['junit', { outputFile: 'junit-e2e.xml' }]], webServer: { command: 'node src/server.js 3998', port: 3998 }, use: { baseURL: 'http://localhost:3998' } }
