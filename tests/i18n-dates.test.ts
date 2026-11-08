import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatTimestamp } from '../src/i18n.js';

test('appointment dates stay in the chosen language without host locale support', (t) => {
  t.mock.method(Intl, 'DateTimeFormat', () => { throw new Error('Locale data unavailable'); });
  assert.equal(formatDate('2026-11-22', 'ha'), '22 Nuwamba, 2026');
  assert.equal(formatDate('2026-11-22', 'en'), '22 November 2026');
  assert.equal(formatDate('2028-02-29', 'ha'), '29 Faburairu, 2028');
});

test('record timestamps use Gombe time across midnight and year boundaries', () => {
  assert.equal(formatTimestamp('2026-11-08T23:45:00Z', 'ha'), '9 Nuw, 2026, 00:45');
  assert.equal(formatTimestamp('2026-12-31T23:00:00Z', 'en'), '1 Jan 2027, 00:00');
  assert.equal(formatTimestamp('2026-12-31T23:00:00Z', 'ha'), '1 Jan, 2027, 00:00');
  assert.equal(formatTimestamp('2026-06-01T12:05:00Z', 'ha'), '1 Yun, 2026, 13:05');
});
