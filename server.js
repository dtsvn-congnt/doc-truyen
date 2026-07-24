const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const googleTTS = require('google-tts-api');
const pako = require('pako');
const path = require('path');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const googleHosts = [
    'https://translate.google.com',
    'https://translate.google.com.vn',
    'https://translate.google.co.jp',
    'https://translate.google.fr',
    'https://translate.google.de',
    'https://translate.google.ru',
    'https://translate.google.com.br',
    'https://translate.google.co.in'
];

// --- HÀM GIẢI MÃ DATA_X ---
function decodeContent(encodedString) {
    const s = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const c = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';

    let base64String = '';
    for (const char of encodedString) {
        const idx = c.indexOf(char);
        base64String += (idx > -1) ? s[idx] : char;
    }

    const binaryData = Uint8Array.from(atob(base64String), c => c.charCodeAt(0));
    const decompressedData = pako.inflate(binaryData);
    const decodedHtml = new TextDecoder().decode(decompressedData);
    return decodedHtml;
}

// --- PLAYWRIGHT BROWSER INSTANCE ---
// Khởi tạo một biến để giữ instance của trình duyệt
let browserInstance;

// Hàm để khởi tạo hoặc lấy lại instance của trình duyệt
async function getBrowser() {
    if (!browserInstance) {
        console.log("Khởi tạo Playwright browser instance...");
        browserInstance = await chromium.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
    }
    return browserInstance;
}

// --- 1. API LẤY NỘI DUNG TRUYỆN ---
app.get('/api/speak', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Thiếu URL' });

    let page; // Khai báo page ở ngoài để có thể đóng trong khối finally
    try {
        // Lấy instance trình duyệt đã được khởi tạo
        const browser = await getBrowser();
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
        });
        page = await context.newPage();

        // --- TỐI ƯU HÓA: Chặn các tài nguyên không cần thiết để tiết kiệm RAM và tăng tốc ---
        await page.route('**/*', (route) => {
            const resourceType = route.request().resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                route.abort();
            } else {
                route.continue();
            }
        });

        console.log(`Đang tải trang bằng Playwright: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        console.log("Tải trang thành công.");

        // --- CHỜ ĐỢI THÔNG MINH: Chờ cho đến khi phần tử nội dung truyện thực sự xuất hiện ---
        // Đây là cách chắc chắn nhất để biết đã vượt qua Cloudflare
        console.log("Đang chờ selector nội dung truyện ('#chapter-reading-content' hoặc 'script:contains(\"data_x\")')...");
        await page.waitForSelector('#chapter-reading-content, script:contains("const data_x")', { timeout: 60000 });
        console.log("Selector đã xuất hiện! Đã vượt qua Cloudflare.");

        // Lấy nội dung HTML sau khi trang đã tải xong
        const body = await page.content();
        console.log(`Lấy nội dung HTML thành công, độ dài: ${body.length}`);

        // Không đóng browser, chỉ đóng page
        await page.close();
        console.log("Đã đóng page Playwright.");

        const $ = cheerio.load(body);

        const nextElement = $('div.nav-next a');
        let nextLink = nextElement.attr('href');

        if (nextLink && !nextLink.startsWith('http')) {
            nextLink = new URL(nextLink, url).href;
        }

        const chapterDiv = $('#chapter-reading-content');
        let content = "";

        // Tìm data_x để giải mã
        const scriptContent = $('script:contains("const data_x")').html();
        const match = scriptContent ? scriptContent.match(/const data_x\s*=\s*['"]([^'"]+)['"]\s*;/) : null;

        if (match && match[1]) {
            console.log("Tìm thấy data_x. Bắt đầu giải mã...");
            const encodedContent = match[1];
            const decodedHtml = decodeContent(encodedContent);

            const $content = cheerio.load(decodedHtml);
            $content('br').replaceWith('. ');
            $content('p').append('. ');

            content = $content.text();
            console.log("Giải mã thành công data_x!");
        } else if (chapterDiv.length) {
            console.log("Không tìm thấy data_x, sử dụng phương pháp cũ.");
            chapterDiv.find('p').each((i, el) => {
                $(el).append('. ');
            });
            content = chapterDiv.text();
        }

        if (content) {
             content = content
                .replace(/\s+/g, ' ')
                .replace(/\.(\s*\.)+/g, '.')
                .replace(/([”"'])\./g, '$1')
                .trim();
        }

        res.json({ content, nextLink });

    } catch (error) {
        console.error("--- LỖI TRONG QUÁ TRÌNH SCRAPING ---");
        // Nếu là lỗi timeout, cung cấp thông báo rõ ràng hơn
        if (error.name === 'TimeoutError') {
            console.error("Lỗi TimeoutError: Playwright đã không thể tìm thấy selector nội dung trong thời gian cho phép. Rất có thể vẫn bị Cloudflare chặn.");
        } else {
            console.error("Lỗi chi tiết:", error); // In ra toàn bộ lỗi để dễ debug
        }
        res.status(500).json({ error: "Lỗi tải trang truyện bằng Playwright. " + error.message });
    } finally {
        // Đảm bảo page luôn được đóng dù có lỗi hay không
        if (page && !page.isClosed()) {
            await page.close();
        }
    }
});

// --- 2. API TRUNG GIAN TẢI MP3 (PROXY) ---
app.get('/api/tts', async (req, res) => {
    const { text } = req.query;
    if (!text) return res.status(400).send('Thiếu text');

    const randomHost = googleHosts[Math.floor(Math.random() * googleHosts.length)];

    try {
        const url = googleTTS.getAudioUrl(text, {
            lang: 'vi',
            slow: false,
            host: randomHost,
            splitPunctuation: true,
        });

        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': randomHost
            }
        });

        res.set({
            'Content-Type': 'audio/mpeg',
            'Cache-Control': 'no-cache',
        });

        response.data.pipe(res);

    } catch (error) {
        console.error("Lỗi TTS:", error.message);
        res.status(500).send("Lỗi tạo giọng nói");
    }
});

// Khởi động server sau khi đã khởi tạo trình duyệt lần đầu
getBrowser().then(() => {
    app.listen(PORT, () => {
        console.log(`Server chạy tại: http://localhost:${PORT}`);
    });
}).catch(error => {
    console.error("Không thể khởi tạo trình duyệt Playwright!", error);
    process.exit(1);
});