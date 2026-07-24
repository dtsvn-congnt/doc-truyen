const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const googleTTS = require('google-tts-api');
const pako = require('pako');
const path = require('path');
const { firefox } = require('playwright-firefox');

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
let browserContext; // Biến để giữ context

// Hàm để khởi tạo hoặc lấy lại instance của trình duyệt
async function getBrowser() {
    // Nếu trình duyệt không kết nối được (bị treo/lỗi), khởi tạo lại
    if (!browserInstance || !browserInstance.isConnected()) {
        console.log("Khởi tạo hoặc khởi động lại Playwright browser instance...");
        browserInstance = await firefox.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            // Thêm các biến môi trường để tắt các tính năng sandbox của Firefox
            // đang gây crash trên môi trường container bị giới hạn.
            env: {
                ...process.env,
                MOZ_DISABLE_CONTENT_SANDBOX: '1',
            }
        });
        browserContext = await browserInstance.newContext({
            // Giả lập thông số của một trình duyệt người dùng thật
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
            viewport: { width: 1920, height: 1080 },
            locale: 'vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
            timezoneId: 'Asia/Ho_Chi_Minh',
            geolocation: { latitude: 21.028511, longitude: 105.804817 }, // Tọa độ Hà Nội
            permissions: ['geolocation']
        });
        console.log("Browser và Context đã được khởi tạo với thông số giả lập.");
    }
    // Trả về context để tái sử dụng
    return browserContext;
}

// --- 1. API LẤY NỘI DUNG TRUYỆN ---
app.get('/api/speak', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Thiếu URL' });

    let page; // Khai báo page ở ngoài để có thể đóng trong khối finally
    try {
        // Lấy context đã được khởi tạo để tái sử dụng
        const context = await getBrowser();
        console.log("bắt đâu tải trang bằng Playwright.");
        page = await context.newPage();

        console.log(`Đang tải trang bằng Playwright: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        console.log("Tải trang thành công.");

        // Lấy nội dung HTML sau khi trang đã tải xong
        const body = await page.content();
        console.log(`Lấy nội dung HTML thành công, độ dài: ${body.length}`);

        // Không đóng browser, chỉ đóng page
        await page.close();
        console.log("Đã đóng page Playwright.");

        const $ = cheerio.load(body);

        let content = "";

        // Ưu tiên tìm data_x để giải mã trước
        const scriptContent = $('script:contains("const data_x")').html();
        const match = scriptContent ? scriptContent.match(/const data_x\s*=\s*['"]([^'"]+)['"]\s*;/) : null;

        if (match && match[1]) {
            console.log("Tìm thấy data_x. Bắt đầu giải mã...");
            const encodedContent = match[1];
            const decodedHtml = decodeContent(encodedContent); // Hàm giải mã bạn đã có

            const $content = cheerio.load(decodedHtml);
            // Thêm dấu chấm sau mỗi thẻ <br> và <p> để ngắt nghỉ khi đọc
            $content('br').replaceWith('. ');
            $content('p').append('. ');

            content = $content.text();
            console.log("Giải mã thành công data_x!");
        } else {
            console.log("Không tìm thấy data_x, sử dụng phương pháp cũ.");
            const chapterDiv = $('#chapter-reading-content');
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

        // Lấy link chương tiếp theo
        const nextElement = $('div.nav-next a');
        let nextLink = nextElement.attr('href');
        if (nextLink && !nextLink.startsWith('http')) {
            nextLink = new URL(nextLink, url).href;
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