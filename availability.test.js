import test from 'node:test';
import assert from 'node:assert/strict';
import {
    AVAILABILITY_PROXY_URLS,
    dateKey,
    fetchIcalFeed,
    fetchUnavailableDates,
    parseIcalDate,
    parseUnavailableDates
} from './availability.js';

const sampleIcal = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261010
DTEND;VALUE=DATE:20261013
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261020
DTEND;VALUE=DATE:20261022
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;

test('parses an iCal date as a UTC date', () => {
    assert.equal(dateKey(parseIcalDate('DTSTART;VALUE=DATE:20261010')), '2026-10-10');
});

test('returns null for an invalid iCal date', () => {
    assert.equal(parseIcalDate('DTSTART;VALUE=DATE:not-a-date'), null);
});

test('expands reserved events through the day before DTEND', () => {
    assert.deepEqual(
        [...parseUnavailableDates(sampleIcal)],
        ['2026-10-10', '2026-10-11', '2026-10-12']
    );
});

test('ignores cancelled events', () => {
    const unavailableDates = parseUnavailableDates(sampleIcal);

    assert.equal(unavailableDates.has('2026-10-20'), false);
    assert.equal(unavailableDates.has('2026-10-21'), false);
});

test('unfolds continued iCal lines before parsing events', () => {
    const ical = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:2026110\r\n 2\r\nEND:VEVENT\r\nEND:VCALENDAR';

    assert.deepEqual([...parseUnavailableDates(ical)], ['2026-11-01']);
});

test('fetches a calendar feed through its proxy', async () => {
    const calls = [];
    const fetchImplementation = async url => {
        calls.push(url);
        return {
            ok: true,
            status: 200,
            text: async () => sampleIcal
        };
    };

    assert.equal(await fetchIcalFeed(AVAILABILITY_PROXY_URLS[0].url, 'Airbnb', fetchImplementation), sampleIcal);
    assert.equal(calls.length, 1);
    assert.equal(calls[0], AVAILABILITY_PROXY_URLS[0].url);
});

test('merges reserved dates from Airbnb and VRBO', async () => {
    const calls = [];
    const vrboIcal = sampleIcal.replace('20261010', '20261101').replace('20261013', '20261103');
    const fetchImplementation = async url => {
        calls.push(url);
        return {
            ok: true,
            status: 200,
            text: async () => url === AVAILABILITY_PROXY_URLS[0].url ? sampleIcal : vrboIcal
        };
    };

    const unavailableDates = await fetchUnavailableDates(fetchImplementation);

    assert.deepEqual([...unavailableDates], [
        '2026-10-10', '2026-10-11', '2026-10-12',
        '2026-11-01', '2026-11-02'
    ]);
    assert.deepEqual(calls.sort(), AVAILABILITY_PROXY_URLS.map(feed => feed.url).sort());
});

test('keeps dates when one calendar feed fails', async () => {
    const fetchImplementation = async url => {
        if (url === AVAILABILITY_PROXY_URLS[0].url) {
            throw new Error('Airbnb unavailable');
        }

        return {
            ok: true,
            status: 200,
            text: async () => sampleIcal
        };
    };

    assert.deepEqual(
        [...await fetchUnavailableDates(fetchImplementation)],
        ['2026-10-10', '2026-10-11', '2026-10-12']
    );
});

test('rejects when both calendar feeds fail', async () => {
    const fetchImplementation = async () => {
        throw new Error('Feeds unavailable');
    };

    await assert.rejects(fetchUnavailableDates(fetchImplementation), /No availability feeds could be loaded/);
});

test('rejects a successful response that is not iCal', async () => {
    const fetchImplementation = async () => ({
        ok: true,
        status: 200,
        text: async () => '<html>not a calendar</html>'
    });

    await assert.rejects(
        fetchIcalFeed(AVAILABILITY_PROXY_URLS[0].url, 'Airbnb', fetchImplementation),
        /Invalid Airbnb availability feed/
    );
});
