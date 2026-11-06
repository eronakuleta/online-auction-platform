// Turns a `jest --json` result into the evidence table format from CLAUDE.md:
//   ID | Input | Expected | Actual | Pass/Fail
// Only tests that really ran are listed. Usage, from the repository root:
//   npx jest --json --outputFile=jest.json -c backend/services/auth-service/jest.config.js
//     --rootDir backend/services/auth-service
//   node docs/test-evidence/generate.mjs jest.json AUTH "auth-service (A-09)"
//     docs/test-evidence/auth-service.md
// (each command on one line). jest.json is a temporary file; do not commit it.
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const [jsonPath, prefix, title, outPath] = process.argv.slice(2);
const result = JSON.parse(readFileSync(jsonPath, 'utf8'));
const clean = (text) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

const rows = [];
const files = [...result.testResults].sort((a, b) => a.name.localeCompare(b.name));
for (const file of files) {
  const fileName = file.name.split(/[\\/]/).pop();
  for (const test of file.assertionResults) {
    const area = test.ancestorTitles.join(' › ') || fileName.replace(/\.test\.ts$/, '');
    const passed = test.status === 'passed';
    rows.push({
      input: `${area} (${fileName})`,
      expected: test.title,
      actual: passed
        ? 'As expected'
        : `Failed: ${clean((test.failureMessages[0] ?? '').split('\n')[0])}`,
      verdict: passed ? 'Pass' : 'Fail',
    });
  }
}

const passedCount = rows.filter((row) => row.verdict === 'Pass').length;
const date = new Date(result.startTime).toISOString().slice(0, 16).replace('T', ' ');
const lines = [
  `# Test evidence: ${title}`,
  '',
  `Generated from a real run of \`npx jest --json\` on ${date} UTC against the Docker Compose`,
  'PostgreSQL 16 (integration tests use a throwaway database built from the SQL files). Each row is',
  'one test that ran; "Expected" is the behaviour the test asserts. Regenerate after changing tests',
  '(the commands are at the top of `docs/test-evidence/generate.mjs`).',
  '',
  `**Result: ${passedCount} of ${rows.length} passed.**`,
  '',
  '| ID | Input | Expected | Actual | Pass/Fail |',
  '| --- | --- | --- | --- | --- |',
  ...rows.map(
    (row, index) =>
      `| ${prefix}-${String(index + 1).padStart(3, '0')} | ${clean(row.input)} | ${clean(row.expected)} | ${row.actual} | ${row.verdict} |`,
  ),
  '',
];
writeFileSync(outPath, lines.join('\n'));
process.stdout.write(`${passedCount}/${rows.length} rows written to ${outPath}\n`);
