const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const googleTTS = require('google-tts-api');
const path = require('path');
const fs = require('fs').promises; // Thêm module 'fs' để đọc file

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

// --- 1. API LẤY NỘI DUNG TRUYỆN TỪ FILE LOCAL ---
app.get('/api/speak', async (req, res) => {
    const { chapter } = req.query;
    if (!chapter || isNaN(parseInt(chapter, 10))) {
        return res.status(400).json({ error: 'Tham số "chapter" phải là một số.' });
    }

    const currentChapterNum = parseInt(chapter, 10);
    // Định dạng số chương thành chuỗi 4 chữ số, có số 0 ở đầu (vd: 208 -> "0208")
    const formatChapterString = (num) => num.toString().padStart(4, '0');
    const chapterFileName = `chapter-${formatChapterString(currentChapterNum)}.html`;

    try {
        // Giả định các file chapter nằm trong thư mục /data và có đuôi .html
        const filePath = path.join(__dirname, 'data', chapterFileName);

        console.log(`Đang đọc file: ${filePath}`);
        const htmlContent = await fs.readFile(filePath, 'utf-8');
        console.log(`Đọc file thành công, độ dài: ${htmlContent.length}`);

        // Nạp HTML vào Cheerio để bóc tách
        const $ = cheerio.load(htmlContent);
        let content = "";

        // Dựa trên cấu trúc file chapter-0383.html, nội dung nằm trong thẻ <div>
        // và các đoạn văn cách nhau bởi <br>.
        console.log("Đọc nội dung trực tiếp từ thẻ div...");
        const contentDiv = $('div').first(); // Lấy thẻ div đầu tiên
        if (contentDiv.length) {
            // Thay thế các thẻ <br> bằng dấu chấm để tạo câu cho TTS
            contentDiv.find('br').replaceWith('. ');
            content = contentDiv.text();
        } else {
            // Dự phòng nếu file không có thẻ div, đọc toàn bộ body
            $('body').find('br').replaceWith('. ');
            content = $('body').text();
        }

        if (content) {
            content = content
                .replace(/\s+/g, ' ')
                .replace(/\.(\s*\.)+/g, '.')
                .replace(/([”"'])\./g, '$1')
                .trim();
        }

        // --- LOGIC MỚI: TÌM CHƯƠNG TIẾP THEO BẰNG CÁCH KIỂM TRA FILE ---
        let nextLink = null;
        const nextChapterNum = currentChapterNum + 1;
        const nextChapterFileName = `chapter-${formatChapterString(nextChapterNum)}.html`;
        const nextFilePath = path.join(__dirname, 'data', nextChapterFileName);

        try {
            // Kiểm tra xem file của chương tiếp theo có tồn tại không
            await fs.access(nextFilePath);
            // Nếu không có lỗi, file tồn tại -> trả về số của chương tiếp theo
            nextLink = nextChapterNum.toString();
            console.log(`Tìm thấy chương tiếp theo: ${nextChapterFileName}`);
        } catch (e) {
            // Nếu có lỗi (ENOENT), file không tồn tại
            console.log(`Không tìm thấy chương tiếp theo: ${nextChapterFileName}`);
        }

        res.json({ content, nextLink });
    } catch (error) {
        console.error("--- LỖI QUÁ TRÌNH ĐỌC FILE TRUYỆN ---", error.message);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: `Không tìm thấy file chapter: ${chapterFileName}` });
        } else {
            res.status(500).json({ error: "Lỗi đọc file truyện: " + error.message });
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

// Khởi động server
app.listen(PORT, () => {
    console.log(`Server khởi động thành công trên cổng: ${PORT}`);
});