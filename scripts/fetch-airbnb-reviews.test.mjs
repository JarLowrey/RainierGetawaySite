import test from 'node:test';
import assert from 'node:assert/strict';
import { collectReviews, normalizeReviewDate } from './fetch-airbnb-reviews.mjs';

const referenceDate = new Date('2026-01-05T12:00:00Z');

test('normalizes Airbnb relative review dates to month and year', () => {
    assert.equal(normalizeReviewDate('Today', referenceDate), '1/2026');
    assert.equal(normalizeReviewDate('Yesterday', referenceDate), '1/2026');
    assert.equal(normalizeReviewDate('1 week ago', referenceDate), '12/2025');
    assert.equal(normalizeReviewDate('3 days ago', referenceDate), '1/2026');
    assert.equal(normalizeReviewDate('2 weeks ago', referenceDate), '12/2025');
    assert.equal(normalizeReviewDate('2 months ago', referenceDate), '11/2025');
    assert.equal(normalizeReviewDate('2 years ago', referenceDate), '1/2024');
    assert.equal(normalizeReviewDate('last week', referenceDate), '12/2025');
});

test('normalizes absolute Airbnb review dates without timezone shifts', () => {
    assert.equal(normalizeReviewDate('August 2026', referenceDate), '8/2026');
    assert.equal(normalizeReviewDate('August 15, 2026', referenceDate), '8/2026');
    assert.equal(normalizeReviewDate('2026-08-31T23:00:00-07:00', referenceDate), '8/2026');
});

test('rejects invalid review dates and handles leap-day year subtraction', () => {
    assert.equal(normalizeReviewDate('February 31, 2026', referenceDate), null);
    assert.equal(
        normalizeReviewDate('1 year ago', new Date('2024-02-29T12:00:00Z')),
        '2/2023'
    );
});

test('collects valid reviews without exposing reviewer or author data', () => {
    const reviews = collectReviews({
        reviews: [
            {
                id: 'review-1',
                rating: 5,
                localizedDate: 'August 2026',
                comments: 'Wonderful stay',
                reviewer: { name: 'Private Guest', pictureUrl: 'private.jpg' },
                author: { name: 'Private Author' }
            },
            {
                id: 'invalid-review',
                rating: 4,
                localizedDate: 'August 2026',
                comments: 'Also valid, but filtered later by rating'
            }
        ]
    });

    assert.deepEqual(reviews, [
        {
            id: 'review-1',
            rating: 5,
            date: '8/2026',
            text: 'Wonderful stay'
        },
        {
            id: 'invalid-review',
            rating: 4,
            date: '8/2026',
            text: 'Also valid, but filtered later by rating'
        }
    ]);
});