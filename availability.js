const CALENDAR_FEEDS = [
    {
        label: 'Airbnb',
        url: 'https://www.airbnb.com/calendar/ical/1501508351751467254.ics?t=d32d3c50b8464dd492ee0a2338106af9'
    },
    {
        label: 'VRBO',
        url: 'https://www.vrbo.com/icalendar/eeda029ab7a2499dab1888bcc8dd8bbf.ics?nonTentative'
    }
];

export const AVAILABILITY_PROXY_URLS = CALENDAR_FEEDS.map(feed => ({
    label: feed.label,
    url: `https://api.allorigins.win/raw?url=${encodeURIComponent(feed.url)}`
}));

export function parseIcalDate(value) {
    const dateValue = value.split(':').pop().trim();
    const dateParts = dateValue.match(/^(\d{4})(\d{2})(\d{2})/);

    if (!dateParts) {
        return null;
    }

    return new Date(Date.UTC(
        Number(dateParts[1]),
        Number(dateParts[2]) - 1,
        Number(dateParts[3])
    ));
}

export function dateKey(date) {
    return date.toISOString().slice(0, 10);
}

export function parseUnavailableDates(icalText) {
    const lines = icalText.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const unavailableDates = new Set();
    let event = null;

    lines.forEach(line => {
        if (line === 'BEGIN:VEVENT') {
            event = {};
        } else if (line === 'END:VEVENT' && event) {
            if (event.start && event.end && event.status !== 'CANCELLED') {
                for (const date = new Date(event.start); date < event.end; date.setUTCDate(date.getUTCDate() + 1)) {
                    unavailableDates.add(dateKey(date));
                }
            }
            event = null;
        } else if (event && line.startsWith('DTSTART')) {
            event.start = parseIcalDate(line);
        } else if (event && line.startsWith('DTEND')) {
            event.end = parseIcalDate(line);
        } else if (event && line.startsWith('STATUS:')) {
            event.status = line.slice(7).trim();
        }
    });

    return unavailableDates;
}

export async function fetchIcalFeed(proxyUrl, label, fetchImplementation = fetch) {
    try {
        console.info(`[Availability] Loading ${label} through AllOrigins...`);
        const response = await fetchImplementation(proxyUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`${label} availability feed returned HTTP ${response.status}`);
        }

        const icalText = await response.text();
        if (!icalText.includes('BEGIN:VCALENDAR')) {
            throw new Error(`Invalid ${label} availability feed`);
        }

        console.info(`[Availability] Loaded ${label} successfully through AllOrigins.`);
        return icalText;
    } catch (error) {
        console.error(`[Availability] ${label} request failed.`, error);
        throw error;
    }
}

export async function fetchUnavailableDates(fetchImplementation = fetch) {
    const results = await Promise.allSettled(
        AVAILABILITY_PROXY_URLS.map(feed => fetchIcalFeed(feed.url, feed.label, fetchImplementation))
    );
    const unavailableDates = new Set();
    let successfulFeeds = 0;

    results.forEach((result, index) => {
        const feed = AVAILABILITY_PROXY_URLS[index];
        if (result.status === 'fulfilled') {
            successfulFeeds += 1;
            parseUnavailableDates(result.value).forEach(date => unavailableDates.add(date));
        } else {
            console.warn(`[Availability] ${feed.label} dates could not be merged.`, result.reason);
        }
    });

    if (successfulFeeds === 0) {
        throw new Error('No availability feeds could be loaded');
    }

    return unavailableDates;
}
