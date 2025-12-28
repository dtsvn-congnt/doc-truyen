const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const googleTTS = require('google-tts-api');
const path = require('path'); // Thêm thư viện đường dẫn
const app = express();
const PORT = process.env.PORT || 3000;

// --- SỬA LỖI CANNOT GET / ---
// Cho phép server phục vụ các file tĩnh (html, css) ở ngay thư mục hiện tại
app.use(express.static(__dirname));

// Khi người dùng vào trang chủ (localhost:3000), gửi file index.html về
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- DANH SÁCH TÊN MIỀN GOOGLE (XOAY VÒNG) ---
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

// --- 1. API LẤY NỘI DUNG TRUYỆN ---
app.get('/api/speak', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Thiếu URL' });

    try {
       const { gotScraping } = await import('got-scraping');
        const response = await gotScraping({
            url: url,
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 110 }],
                devices: ['desktop'],
                locales: ['vi-VN'],
                operatingSystems: ['windows'],
            },
            
            // Tự động xử lý redirect, tự giải nén gzip
        });
        // -------------------------------------------


         const $ = cheerio.load(response.body);

        // Logic lấy nội dung
        const chapterDiv = $('#chapter_content'); 
        let content = "";
        let nextLink = "";

        const nextElement = $('a:contains("Chương sau"), a.next, a[title="Chương sau"]'); 
        if (nextElement.length) {
            nextLink = nextElement.attr('href');
            if (nextLink && !nextLink.startsWith('http')) {
                const origin = new URL(url).origin;
                nextLink = origin + nextLink;
            }
        }

        if (chapterDiv.length) {
            chapterDiv.find('br').each((i, el) => {
                const prevNode = el.previousSibling;
                if (prevNode && prevNode.type === 'text') {
                    const text = prevNode.data.trim();
                    if (/[.?!"”']$/.test(text)) {
                        $(el).replaceWith(' ');
                        return;
                    }
                }
                $(el).replaceWith('. ');
            });
            chapterDiv.find('p').append('. ');

            content = chapterDiv.text();
            content = content.replace(/\.(\s*\.)+/g, '.');
            content = content.replace(/([”"'])\./g, '$1'); 
            content = content.replace(/\s+/g, ' ').trim();
        }

        res.json({ content, nextLink });

    } catch (error) {
        console.error("Lỗi lấy truyện:", error.message);
        res.status(500).json({ error: "Lỗi tải trang truyện" });
    }
});

// --- 2. API TRUNG GIAN TẢI MP3 (PROXY) ---
app.get('/api/tts', async (req, res) => {
    const { text } = req.query;
    if (!text) return res.status(400).send('Thiếu text');

    const randomHost = googleHosts[Math.floor(Math.random() * googleHosts.length)];
    // console.log(`Đang tải từ: ${randomHost}...`);

    try {
        const url = googleTTS.getAudioUrl(text, {
            lang: 'vi',
            slow: false,
            host: randomHost,
			splitPunctuation: true, // Tự động tách dấu câu
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

app.listen(PORT, () => {
    console.log(`Server đã sửa lỗi xong! Truy cập ngay: http://localhost:${PORT}`);
});