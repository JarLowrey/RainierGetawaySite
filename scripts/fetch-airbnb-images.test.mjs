import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import {
    MAX_DELAY_MS,
    MIN_DELAY_MS,
    downloadImages,
    originalImageUrl,
    uniqueImageUrls
} from './fetch-airbnb-images.mjs';

test('normalizes Airbnb image URLs to original resolution', () => {
    assert.equal(
        originalImageUrl('https://a0.muscache.com/im/pictures/abc.jpg?im_w=1200&im_q=80#gallery'),
        'https://a0.muscache.com/im/pictures/abc.jpg'
    );
    assert.equal(originalImageUrl('https://example.com/logo.svg'), null);
});

test('keeps the first nine image URLs in listing order and removes duplicates', () => {
    const urls = uniqueImageUrls([
        'https://a0.muscache.com/im/pictures/1.jpg?im_w=1200',
        'https://a0.muscache.com/im/pictures/2.jpg?im_w=1200',
        'https://a0.muscache.com/im/pictures/1.jpg?im_w=600'
    ], Array.from({ length: 9 }, (_, index) =>
        `https://a0.muscache.com/im/pictures/${index + 3}.jpg?im_w=1200`
    ));

    assert.deepEqual(urls, Array.from({ length: 9 }, (_, index) =>
        `https://a0.muscache.com/im/pictures/${index + 1}.jpg`
    ));
});

test('waits between image downloads and writes numbered files', async () => {
    const waits = [];
    const urls = Array.from({ length: 9 }, (_, index) =>
        `https://a0.muscache.com/im/pictures/${index + 1}.jpg`
    );
    try {
        const files = await downloadImages({
            urls,
            outputDir: 'tmp-airbnb-images-test',
            random: () => 0,
            wait: milliseconds => waits.push(milliseconds),
            fetchImage: async () => ({
                ok: true,
                headers: new Headers({ 'content-type': 'image/jpeg' }),
                arrayBuffer: async () => new ArrayBuffer(0)
            })
        });

        assert.equal(files.length, 9);
        assert.deepEqual(waits, Array(8).fill(MIN_DELAY_MS));
        assert.ok(waits.every(milliseconds => milliseconds >= MIN_DELAY_MS && milliseconds <= MAX_DELAY_MS));
    } finally {
        await rm('tmp-airbnb-images-test', { recursive: true, force: true });
    }
});