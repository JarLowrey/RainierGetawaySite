import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const AIRBNB_URL = 'https://www.airbnb.com/rooms/1501508351751467254';
export const OUTPUT_DIR = 'images/airbnb_images';
export const IMAGE_COUNT = 9;
export const MIN_DELAY_MS = 15_000;
export const MAX_DELAY_MS = 25_000;

const IMAGE_URL_PATTERN = /^https?:\/\/[^\s"']+\.(?:avif|gif|jpe?g|png|webp)(?:[?#][^\s"']*)?$/i;

export function originalImageUrl(value) {
    if (typeof value !== 'string' || !IMAGE_URL_PATTERN.test(value)) {
        return null;
    }

    const url = new URL(value);
    if (!url.hostname.endsWith('.muscache.com')) {
        return null;
    }
    url.search = '';
    url.hash = '';
    return url.href;
}

function collectImageUrls(value, urls = []) {
    if (typeof value === 'string') {
        const imageUrl = originalImageUrl(value);
        if (imageUrl) urls.push(imageUrl);
        return urls;
    }

    if (Array.isArray(value)) {
        value.forEach(item => collectImageUrls(item, urls));
    } else if (value && typeof value === 'object') {
        Object.values(value).forEach(item => collectImageUrls(item, urls));
    }

    return urls;
}

export function uniqueImageUrls(...sources) {
    const urls = sources.flatMap(source => collectImageUrls(source));
    return [...new Set(urls)].slice(0, IMAGE_COUNT);
}

export function delayBetween(min = MIN_DELAY_MS, max = MAX_DELAY_MS, random = Math.random()) {
    return Math.round(min + random * (max - min));
}

function extensionFor(contentType, sourceUrl) {
    const type = contentType.split(';')[0].toLowerCase();
    const extensions = new Map([
        ['image/avif', '.avif'],
        ['image/gif', '.gif'],
        ['image/jpeg', '.jpg'],
        ['image/png', '.png'],
        ['image/webp', '.webp']
    ]);
    return extensions.get(type) ?? (extname(new URL(sourceUrl).pathname).toLowerCase() || '.jpg');
}

async function scrapeImageSources() {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
        locale: 'en-US',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
    });
    const imagePayloads = [];

    page.on('response', async response => {
        if (!response.headers()['content-type']?.includes('json')) return;
        imagePayloads.push(response.json().catch(() => null));
    });

    await page.goto(AIRBNB_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(2_000);
    const pageImages = await page.locator('img').evaluateAll(images => images.flatMap(image => [
        image.currentSrc,
        image.src,
        image.srcset?.split(',').map(source => source.trim().split(/\s+/)[0]) ?? []
    ]));
    await Promise.allSettled(imagePayloads);
    const payloads = await Promise.all(imagePayloads);
    await browser.close();

    return uniqueImageUrls(pageImages, payloads);
}

export async function downloadImages({
    urls,
    outputDir = OUTPUT_DIR,
    wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    random = Math.random,
    fetchImage = fetch
}) {
    if (urls.length < IMAGE_COUNT) {
        throw new Error(`Only found ${urls.length} Airbnb listing images; ${IMAGE_COUNT} are required`);
    }

    await mkdir(outputDir, { recursive: true });
    const existingFiles = await readdir(outputDir);
    await Promise.all(existingFiles
        .filter(file => /^\d+\.(?:avif|gif|jpe?g|png|webp)$/i.test(file))
        .map(file => rm(join(outputDir, file))));

    const downloadedFiles = [];
    for (const [index, url] of urls.slice(0, IMAGE_COUNT).entries()) {
        if (index > 0) await wait(delayBetween(MIN_DELAY_MS, MAX_DELAY_MS, random()));

        const response = await fetchImage(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!response.ok) {
            throw new Error(`Failed to download image ${index + 1}: ${response.status} ${response.statusText}`);
        }

        const extension = extensionFor(response.headers.get('content-type') ?? '', url);
        const filePath = join(outputDir, `${index + 1}${extension}`);
        await writeFile(filePath, Buffer.from(await response.arrayBuffer()));
        downloadedFiles.push(filePath);
        console.log(`Downloaded image ${index + 1}/${IMAGE_COUNT}`);
    }

    return downloadedFiles;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const urls = await scrapeImageSources();
    const files = await downloadImages({ urls });
    console.log(`Wrote ${files.length} Airbnb images to ${OUTPUT_DIR}`);
}