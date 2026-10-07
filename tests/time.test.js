import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lagosParts, fmtDayLong, fmtStamp, lagosToday, isIsoZ, isDate } from '../site/lib/time.js';

const SRC = readFileSync(new URL('../site/lib/time.js', import.meta.url), 'utf8');

test('lagosParts returns the Lagos wall-clock parts of a UTC instant', () => {
  assert.deepEqual(lagosParts('2026-10-07T22:15:00Z'), {
    date: '2026-10-07', hm: '23:15', dow: 'Wed', day: 7, mon: 'Oct', year: 2026,
  });
});

test('23:00:00Z is 00:00 on the NEXT Lagos date', () => {
  const p = lagosParts('2026-10-07T23:00:00Z');
  assert.equal(p.date, '2026-10-08');
  assert.equal(p.hm, '00:00');
  assert.equal(p.dow, 'Thu');
  assert.equal(p.day, 8);
});

test('22:59:59Z is 23:59 on the SAME Lagos date', () => {
  const p = lagosParts('2026-10-07T22:59:59Z');
  assert.equal(p.date, '2026-10-07');
  assert.equal(p.hm, '23:59');
});

test('year and month boundaries roll over in Lagos time', () => {
  assert.equal(lagosParts('2026-12-31T23:30:00Z').date, '2027-01-01');
  assert.equal(lagosParts('2026-12-31T23:30:00Z').year, 2027);
  assert.equal(lagosParts('2028-02-28T23:00:00Z').date, '2028-02-29'); // leap year
  assert.equal(lagosParts('2026-02-28T23:00:00Z').date, '2026-03-01');
});

test('Lagos is a FIXED UTC+1 offset (no DST): matches the tz database all year', () => {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  for (let m = 1; m <= 12; m++) {
    for (const t of ['00:00:00', '11:30:00', '22:59:59', '23:00:00']) {
      const iso = `2026-${String(m).padStart(2, '0')}-15T${t}Z`;
      const parts = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
      const p = lagosParts(iso);
      assert.equal(p.date, `${parts.year}-${parts.month}-${parts.day}`, iso);
      assert.equal(p.hm, `${parts.hour}:${parts.minute}`, iso);
    }
  }
  // Same wall-clock offset in January and July.
  assert.equal(lagosParts('2026-01-15T12:00:00Z').hm, '13:00');
  assert.equal(lagosParts('2026-07-15T12:00:00Z').hm, '13:00');
});

test('fmtDayLong formats a date-only value without any timezone shift', () => {
  assert.equal(fmtDayLong('2026-10-08'), 'Thu 8 Oct 2026');
  assert.equal(fmtDayLong('2026-10-07'), 'Wed 7 Oct 2026');
  assert.equal(fmtDayLong('2027-01-01'), 'Fri 1 Jan 2027');
  assert.throws(() => fmtDayLong('2026-02-30'), /date/);
  assert.throws(() => fmtDayLong('2026-10-08T00:00:00Z'), /date/);
});

test('fmtStamp formats an instant as Lagos time with the WAT suffix', () => {
  assert.equal(fmtStamp('2026-10-08T22:15:00Z'), '8 Oct 2026, 23:15 WAT');
  assert.equal(fmtStamp('2026-10-07T23:05:00Z'), '8 Oct 2026, 00:05 WAT');
  assert.throws(() => fmtStamp('2026-10-08 22:15:00'), /ISO/);
});

test('lagosToday follows the Lagos calendar day, not the UTC one', () => {
  assert.equal(lagosToday(Date.UTC(2026, 9, 7, 22, 59, 59)), '2026-10-07');
  assert.equal(lagosToday(Date.UTC(2026, 9, 7, 23, 0, 0)), '2026-10-08');
  assert.equal(lagosToday(Date.UTC(2026, 9, 8, 0, 30, 0)), '2026-10-08');
  assert.throws(() => lagosToday(Number.NaN), TypeError);
  assert.throws(() => lagosToday('2026-10-08'), TypeError);
  assert.match(lagosToday(), /^\d{4}-\d{2}-\d{2}$/);
});

test('isIsoZ is strict YYYY-MM-DDTHH:MM:SSZ and a real instant', () => {
  for (const ok of ['2026-10-07T22:15:00Z', '2028-02-29T00:00:00Z', '2026-12-31T23:59:59Z']) {
    assert.equal(isIsoZ(ok), true, ok);
  }
  for (const bad of [
    '2026-10-07T22:15:00.000Z', '2026-10-07T22:15:00+01:00', '2026-10-07 22:15:00Z', '2026-10-07T22:15Z',
    '2026-10-07T24:00:00Z', '2026-10-07T23:60:00Z', '2026-10-07T23:59:60Z', '2026-02-30T00:00:00Z',
    '2026-10-07', ' 2026-10-07T22:15:00Z', '2026-10-07T22:15:00Z\n', '', null, undefined, 0, {},
  ]) {
    assert.equal(isIsoZ(bad), false, JSON.stringify(bad));
  }
});

test('isDate is strict YYYY-MM-DD and a real calendar date', () => {
  for (const ok of ['2026-10-07', '2028-02-29', '2026-12-31', '2026-01-01']) assert.equal(isDate(ok), true, ok);
  for (const bad of [
    '2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-32', '2026-4-01',
    '2026-10-07T00:00:00Z', '20261007', '', null, undefined, 20261007, {},
  ]) {
    assert.equal(isDate(bad), false, JSON.stringify(bad));
  }
});

test('lagosParts rejects anything that is not a strict ISO-Z instant', () => {
  assert.throws(() => lagosParts('2026-10-07T22:15:00+01:00'), /ISO/);
  assert.throws(() => lagosParts(null), /ISO/);
});

test('time.js never reads the host timezone or calls toISOString/toLocale*', () => {
  assert.doesNotMatch(SRC, /\bget(Hours|Minutes|Seconds|Milliseconds|Date|Day|Month|FullYear|Year|TimezoneOffset)\s*\(/);
  assert.doesNotMatch(SRC, /\bset(Hours|Minutes|Seconds|Date|Month|FullYear)\s*\(/);
  assert.doesNotMatch(SRC, /toISOString|toLocale|toDateString|toTimeString/);
  // A multi-argument Date constructor reads its fields as HOST-local time. new Date(Date.UTC(...))
  // is the one legitimate shape (a single epoch argument), so it is excluded.
  assert.doesNotMatch(SRC, /new Date\((?!Date\.UTC\()[^)]*,/);
  assert.doesNotMatch(SRC, /\bIntl\b/);
});

test('the host-timezone guards fire on the shapes they ban', () => {
  for (const bad of ['new Date(y, m, d)', 'new Date(2026, 9, 7, 23)', 'Intl.DateTimeFormat()', 'd.getHours()']) {
    assert.ok([/new Date\((?!Date\.UTC\()[^)]*,/, /\bIntl\b/, /\bget(Hours|Minutes|Seconds|Milliseconds|Date|Day|Month|FullYear|Year|TimezoneOffset)\s*\(/]
      .some((re) => re.test(bad)), bad);
  }
  assert.doesNotMatch('new Date(Date.UTC(y, m, 0))', /new Date\((?!Date\.UTC\()[^)]*,/);
});

test('time.js is isomorphic (no node: imports, require, process or Buffer)', () => {
  assert.doesNotMatch(SRC, /['"]node:/);
  assert.doesNotMatch(SRC, /\brequire\s*\(/);
  assert.doesNotMatch(SRC, /\bprocess\b/);
  assert.doesNotMatch(SRC, /\bBuffer\b/);
});
