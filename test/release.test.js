// The release workflow refuses a tag that doesn't match package.json or has
// no CHANGELOG.md section; catch both before tagging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

test('package.json version is semver and has a CHANGELOG.md section', () => {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const changelog = readFileSync(new URL('CHANGELOG.md', root), 'utf8');
  assert.match(changelog, new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm'),
    `add a "## [${version}] - YYYY-MM-DD" section to CHANGELOG.md`);
});
