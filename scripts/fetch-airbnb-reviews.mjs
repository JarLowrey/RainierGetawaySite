import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

export const AIRBNB_URL = 'https://www.airbnb.com/rooms/1501508351751467254?modal=REVIEWS';
export const OUTPUT_PATH = 'reviews.json';

const reviewTextKeys = ['comments', 'comment', 'text', 'reviewText', 'localizedReviewText'];

function firstString(object, keys) {
    for (const key of keys) {
        if (typeof object[key] === 'string' && object[key].trim()) {
            return object[key].trim();
        }
    }

    return null;
}

function normalizeReview(review) {
    const rating = Number(review.rating ?? review.ratingValue);
    const text = firstString(review, reviewTextKeys);
    const reviewer = review.reviewer ?? review.author ?? {};

    if (!Number.isFinite(rating) || !text) {
        return null;
    }

    return {
        id: String(review.id ?? review.reviewId ?? `${reviewer.name ?? 'reviewer'}:${text}`),
        rating,
        reviewer: typeof reviewer === 'string' ? reviewer : reviewer.name ?? null,
        date: firstString(review, ['localizedDate', 'date', 'createdAt']),
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