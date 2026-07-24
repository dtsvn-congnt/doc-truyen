const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const googleTTS = require('google-tts-api');
const pako = require('pako');
const path = require('path');

// SỬA: Chuyển sang dùng chromium vì plugin stealth chỉ hỗ trợ tốt nhân này
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const googleHosts = [
    'https://translate.google.com',
    'https://translate.google.com.vn'
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
    return new TextDecoder().decode(decompressedData);
}

// --- PLAYWRIGHT BROWSER INSTANCE ---
let browserInstance;

// Hàm này CHỈ giữ vai trò quản lý lõi trình duyệt (Giúp tiết kiệm RAM tối đa)
async function getBrowser() {
    if (!browserInstance || !browserInstance.isConnected()) {
        console.log("Khởi tạo hoặc khởi động lại Playwright Chromium instance...");
        browserInstance = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process' // Rất quan trọng để tối ưu tài nguyên trên Onrender Free
            ]
        });
    }
    return browserInstance;
}

// --- 1. API LẤY NỘI DUNG TRUYỆN ---
app.get('/api/speak', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Thiếu URL' });

    let context;
    let page;

    try {
        const browser = await getBrowser();

        // 💡 BÍ QUYẾT: Tạo một Context mới hoàn toàn độc lập cho mỗi Request
        // Việc này giúp xóa sạch session/cookie cũ, tránh bị Cloudflare chặn dây chuyền
        context = await browser.newContext({
            // Không điền cứng User-Agent cũ, hãy để Stealth tự tạo cấu trúc khớp với Chromium chạy ngầm
            viewport: { width: 1280, height: 800 },
            locale: 'vi-VN',
            timezoneId: 'Asia/Ho_Chi_Minh'
        });

        console.log("Mở tab mới trong Playwright...");
        page = await context.newPage();

        console.log(`Đang tải trang: ${url}`);
        // Chờ trang tải xong phần cơ bản
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // 💡 QUAN TRỌNG: Đợi 4-5 giây để Cloudflare tự chạy ngầm đoạn mã JavaScript thử thách
        console.log("Đang đợi Cloudflare xác thực ẩn...");
        await page.waitForTimeout(4500);

        // Lấy nội dung HTML đã gỡ Cloudflare thành công
        const body = await page.content();
        console.log(`Tải HTML thành công, độ dài: ${body.length}`);

        // Nạp HTML vào Cheerio để bóc tách
        const $ = cheerio.load(body);
        let content = "";

        // Ưu tiên tìm data_x để giải mã trước
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
        } else {
            console.log("Không tìm thấy data_x, thử cào text hiển thị trực tiếp.");
            const chapterDiv = $('#chapter-reading-content');
            if (chapterDiv.length) {
                chapterDiv.find('p').each((i, el) => {
                    $(el).append('. ');
                });
                content = chapterDiv.text();
            }
        }

        if (content) {
             content = content
                .replace(/\s+/g, ' ')
                .replace(/\.(\s*\.)+/g, '.')
                .replace(/([”"'])\./g, '$1')
                .trim();
        }

        const nextElement = $('div.nav-next a');
        let nextLink = nextElement.attr('href');
        if (nextLink && !nextLink.startsWith('http')) {
            nextLink = new URL(nextLink, url).href;
        }

        res.json({ content, nextLink });

    } catch (error) {
        console.error("--- LỖI QUÁ TRÌNH CÀO TRUYỆN ---", error.message);
        res.status(500).json({ error: "Lỗi tải trang truyện: " + error.message });
    } finally {
        // 🚨 CHÚ Ý: Đóng cả page và context để giải phóng RAM triệt để cho Onrender
        if (page && !page.isClosed()) await page.close();
        if (context) await context.close();
        console.log("Đã đóng sạch sẽ session request.");
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

// Khởi động server
getBrowser().then(() => {
    app.listen(PORT, () => {
        console.log(`Server khởi động thành công trên cổng: ${PORT}`);
    });
}).catch(error => {
    console.error("Không thể khởi động trình duyệt gốc!", error);
    process.exit(1);
});