export const AIRBNB_ICAL_URL = 'https://www.airbnb.com/calendar/ical/1501508351751467254.ics?t=d32d3c50b8464dd492ee0a2338106af9';

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

export async function fetchIcalFeed(fetchImplementation = fetch) {
    try {
        console.info('[Availability] Loading Airbnb iCal feed...');
        const response = await fetchImplementation(AIRBNB_ICAL_URL, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Availability feed returned HTTP ${response.status}`);
        }

        const icalText = await response.text();
        if (!icalText.includes('BEGIN:VCALENDAR')) {
            throw new Error('Invalid availability feed');
        }

        console.info('[Availability] Loaded successfully from Airbnb iCal feed.');
        return icalText;
    } catch (error) {
        console.error('[Availability] Airbnb iCal feed failed.', error);
        throw error;
    }
}
