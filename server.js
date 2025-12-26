process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'; // Chấp nhận lỗi SSL nếu có (lưu ý bảo mật)

const express = require('express');
const googleTTS = require('google-tts-api');
const path = require('path');
const axios = require('axios'); // Thay thế cho trình duyệt
const cheerio = require('cheerio'); // Thay thế cho việc quét DOM

const app = express();
const PORT = 3000;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/speak', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send('Thiếu URL');

    console.log("Processing URL:", url);

    try {
        // 1. Tải HTML về bằng AXIOS (Giả lập Headers y như trình duyệt)
        const response = await axios.get(url, {
    headers: {
        // 1. User-Agent xịn (Chrome mới nhất)
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        
        // 2. Giả vờ chấp nhận mọi loại nội dung
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        
        // 3. Quan trọng: Referer (Nói dối là tôi đến từ Google hoặc trang chủ của họ)
        // Cách tốt nhất: Lấy domain gốc của web truyện làm referer
        'Referer': new URL(url).origin + '/', 
        
        // 4. Các headers phụ trợ để giống người dùng thật
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br', // Axios tự giải nén, nhưng cần khai báo để web không nghi ngờ
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1'
    },
    // Quan trọng: Tự động giải nén response (gzip/brotli)
    decompress: true, 
    timeout: 100000
});

        // 2. Load HTML vào Cheerio để xử lý
        const $ = cheerio.load(response.data);

        // 3. Lấy nội dung truyện
        const chapterContentDiv = $('#chapter_content');
        let content = "";

        if (chapterContentDiv.length > 0) {
            // Mẹo nhỏ: Cheerio lấy .text() sẽ dính liền các dòng. 
            // Ta thay thế thẻ <br> thành xuống dòng trước khi lấy text để giống logic cũ.
            chapterContentDiv.find('br').replaceWith('\n');
            chapterContentDiv.find('p').append('\n'); // Thêm xuống dòng sau mỗi thẻ p
            
            content = chapterContentDiv.text();

            // Logic cũ của bạn: Xử lý xuống dòng thành dấu chấm để Google đọc ngắt nghỉ
            content = content.replace(/\n/g, '. ').replace(/\s+/g, ' ');
        }

        // 4. Lấy Link Next Chapter
        const nextElement = $('a.next-chapter');
        let nextLink = nextElement.attr('href');

        // LƯU Ý QUAN TRỌNG: Cheerio lấy href gốc (VD: /chuong-2.html), 
        // nó không tự thêm domain như Puppeteer. Ta phải tự nối domain vào.
        if (nextLink && !nextLink.startsWith('http')) {
            // Sử dụng URL constructor để nối domain gốc vào link tương đối
            const absoluteUrl = new URL(nextLink, url).href;
            nextLink = absoluteUrl;
        }

        // 5. Trả về Header Next-Url
        if (nextLink) {
            res.set('X-Next-Url', encodeURI(nextLink));
        }

        // 6. Xử lý TTS
        await handleTTS(content, res);

    } catch (err) {
        console.error("Lỗi cào dữ liệu:", err.message);
        // Kiểm tra nếu lỗi do Axios (VD: 404, 403)
        if (err.response) {
            return res.status(err.response.status).send(`Lỗi từ web nguồn: ${err.response.statusText}`);
        }
        res.status(500).send('Lỗi server nội bộ');
    }
});

async function handleTTS(text, res) {
    if (!text || text.trim().length === 0) return res.status(400).send('Không tìm thấy nội dung truyện');

    try {
        // Cắt bớt nếu text quá dài để tránh lỗi Google TTS (Giới hạn khoảng 200 ký tự mỗi request của lib này)
        // Nhưng google-tts-api tự xử lý split, chỉ cần đảm bảo server không timeout
        
        const results = await googleTTS.getAllAudioBase64(text, {
            lang: 'vi',
            slow: false,
            host: 'https://translate.google.com',
            splitPunct: ',.?!',
        });
        
        const combinedBase64 = results.map(item => item.base64).join('');
        const audioBuffer = Buffer.from(combinedBase64, 'base64');

        res.set({ 
            'Content-Type': 'audio/mp3', 
            'Content-Length': audioBuffer.length,
            'Access-Control-Expose-Headers': 'X-Next-Url' 
        });
        res.send(audioBuffer);
    } catch (err) {
        console.error("Lỗi TTS:", err);
        res.status(500).send('Lỗi khi chuyển giọng nói');
    }
}

app.listen(PORT, () => {
    console.log('Server running at http://localhost:' + PORT);
});