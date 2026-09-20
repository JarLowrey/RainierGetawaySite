import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const AIRBNB_URL = 'https://www.airbnb.com/rooms/1501508351751467254?modal=REVIEWS';
export const OUTPUT_PATH = 'data/reviews.json';

const reviewTextKeys = ['comments', 'comment', 'text', 'reviewText', 'localizedReviewText'];
const dateKeys = ['localizedDate', 'date', 'createdAt'];
const monthNumbers = new Map([
    ['january', 0], ['jan', 0],
    ['february', 1], ['feb', 1],
    ['march', 2], ['mar', 2],
    ['april', 3], ['apr', 3],
    ['may', 4],
    ['june', 5], ['jun', 5],
    ['july', 6], ['jul', 6],
    ['august', 7], ['aug', 7],
    ['september', 8], ['sep', 8], ['sept', 8],
    ['october', 9], ['oct', 9],
    ['november', 10], ['nov', 10],
    ['december', 11], ['dec', 11]
]);
const relativeAmounts = new Map([
    ['a', 1],
    ['an', 1],
    ['one', 1]
]);

function firstString(object, keys) {
    for (const key of keys) {
        if (typeof object[key] === 'string' && object[key].trim()) {
            return object[key].trim();
        }
    }

    return null;
}

function monthYear(date) {
    return `${date.getUTCMonth() + 1}/${date.getUTCFullYear()}`;
}

function calendarDate(year, month, day) {
    const date = new Date(Date.UTC(year, month, day));
    return date.getUTCFullYear() === year &&
        date.getUTCMonth() === month &&
        date.getUTCDate() === day
        ? date
        : null;
}

function subtractYears(date, amount) {
    const originalDay = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCFullYear(date.getUTCFullYear() - amount);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(originalDay, lastDay));
}

export function normalizeReviewDate(value, now = new Date()) {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }

    const normalized = value.trim().replace(/\s+/g, ' ');
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    let date = null;

    if (/^(?:today|just now)$/i.test(normalized)) {
        date = today;
    } else if (/^yesterday$/i.test(normalized)) {
        today.setUTCDate(today.getUTCDate() - 1);
        date = today;
    } else {
        const relativeMatch = normalized.match(/^(?:a|an|one|\d+)\s+(day|week|month|year)s?\s+ago$/i);
        if (relativeMatch) {
            const amountText = normalized.match(/^(a|an|one|\d+)/i)[1];
            const numericAmount = Number(amountText);
            const amount = Number.isNaN(numericAmount)
                ? relativeAmounts.get(amountText.toLowerCase())
                : numericAmount;
            const unit = relativeMatch[1].toLowerCase();
            date = today;

            if (unit === 'day') {
                date.setUTCDate(date.getUTCDate() - amount);
            } else if (unit === 'week') {
                date.setUTCDate(date.getUTCDate() - amount * 7);
            } else if (unit === 'month') {
                date.setUTCDate(1);
                date.setUTCMonth(date.getUTCMonth() - amount);
            } else {
                subtractYears(date, amount);
            }
        } else {
            const lastPeriodMatch = normalized.match(/^last\s+(day|week|month|year)$/i);
            if (lastPeriodMatch) {
                const unit = lastPeriodMatch[1].toLowerCase();
                date = today;
                if (unit === 'day') {
                    date.setUTCDate(date.getUTCDate() - 1);
                } else if (unit === 'week') {
                    date.setUTCDate(date.getUTCDate() - 7);
                } else if (unit === 'month') {
                    date.setUTCDate(1);
                    date.setUTCMonth(date.getUTCMonth() - 1);
                } else {
                    subtractYears(date, 1);
                }
            }
        }
    }

    if (!date) {
        const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
        const namedDateMatch = normalized.match(/^([A-Za-z]+)\s+(?:(\d{1,2})(?:,\s*)?)?(\d{4})$/);
        if (isoMatch) {
            date = calendarDate(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
        } else if (namedDateMatch && monthNumbers.has(namedDateMatch[1].toLowerCase())) {
            date = calendarDate(
                Number(namedDateMatch[3]),
                monthNumbers.get(namedDateMatch[1].toLowerCase()),
                Number(namedDateMatch[2] ?? 1)
            );
        }
    }

    return date ? monthYear(date) : null;
}

function normalizeReview(review, now = new Date()) {
    const rating = Number(review.rating ?? review.ratingValue);
    const text = firstString(review, reviewTextKeys);
    const date = normalizeReviewDate(firstString(review, dateKeys), now);

    if (!Number.isFinite(rating) || !text) {
        return null;
    }

    return {
        id: String(review.id ?? review.reviewId ?? `${date ?? 'unknown'}:${text}`),
        rating,
        date,
        text
    };
}

export function collectReviews(value, reviews = []) {
    if (!value || typeof value !== 'object') {
        return reviews;
    }

    if (Array.isArray(value)) {
        value.forEach(item => collectReviews(item, reviews));
        return reviews;
    }

    const review = normalizeReview(value);
    if (review) {
        reviews.push(review);
    }

    Object.values(value).forEach(item => collectReviews(item, reviews));
    return reviews;
}

function uniqueReviews(reviews) {
    return [...new Map(reviews.map(review => [review.id, review])).values()];
}

async function fetchReviews() {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
        locale: 'en-US',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
    });
    const reviewResponses = [];
    const pendingResponses = [];

    page.on('response', async response => {
        if (!/review/i.test(response.url()) || !response.headers()['content-type']?.includes('json')) {
            return;
        }

        pendingResponses.push(response.json()
            .then(payload => reviewResponses.push(payload))
            .catch(() => {}));
    });

    await page.goto(AIRBNB_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByRole('button', { name: /show all \d+ reviews/i }).click({ timeout: 30_000 });

    const scrollable = page.locator('[data-testid*="review"] [data-testid*="scroll"], [role="dialog"]');
    for (let attempt = 0; attempt < 12; attempt += 1) {
        await scrollable.evaluate(element => element.scrollTo(0, element.scrollHeight)).catch(() => {});
        await page.waitForTimeout(500);
    }

    await page.waitForTimeout(1_000);
    await Promise.allSettled(pendingResponses);

    const allReviews = uniqueReviews(reviewResponses.flatMap(payload => collectReviews(payload)));
    const pageText = await page.locator('body').innerText();
    const expectedReviewCount = Number(pageText.match(/from (\d+) reviews/i)?.[1] ?? 0);
    if (expectedReviewCount && allReviews.length < expectedReviewCount) {
        await browser.close();
        throw new Error(`Only collected ${allReviews.length} of Airbnb's ${expectedReviewCount} reviews`);
    }

    const reviews = allReviews.filter(review => review.rating === 5);
    await browser.close();

    const fiveStarReviews = reviews.filter(review => review.rating === 5);
    if (!fiveStarReviews.length) {
        throw new Error('No five-star reviews were found in Airbnb review responses');
    }

    return fiveStarReviews;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const reviews = await fetchReviews();
    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify({
        listingId: '1501508351751467254',
        listingUrl: AIRBNB_URL,
        fetchedAt: new Date().toISOString(),
        rating: 5,
        count: reviews.length,
        reviews
    }, null, 2)}\n`, 'utf8');

    console.log(`Wrote ${reviews.length} five-star reviews to ${OUTPUT_PATH}`);
}