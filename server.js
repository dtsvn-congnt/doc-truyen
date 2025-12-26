process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'
const express = require('express');
const googleTTS = require('google-tts-api');
const path = require('path');
const puppeteer = require('puppeteer');

const app = express();
const PORT = 3000;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/speak', async (req, res) => {
    // const text = req.query.text;
    // if (!text) return res.status(400).send('Thiếu text');

    // try {
    //     const results = await googleTTS.getAllAudioBase64(text, {
    //         lang: 'vi',
    //         slow: false,
    //         host: 'https://translate.google.com',
    //         timeout: 10000,
    //         splitPunct: ',.?!',
    //     });
    //     const combinedBase64 = results.map(item => item.base64).join('');
    //     const audioBuffer = Buffer.from(combinedBase64, 'base64');

    //     res.set({
    //         'Content-Type': 'audio/mp3',
    //         'Content-Length': audioBuffer.length,
    //     });
    //     res.send(audioBuffer);
    // } catch (err) {
    //     console.error(err);
    //     res.status(500).send('Lỗi server');
    // }
    try {
    const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    timeout: 0
    });
    const page = await browser.newPage();

    // 1. GIẢ LẬP NGƯỜI DÙNG THẬT (Rất quan trọng để không bị chặn)
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Đặt thêm Header tiếng Việt để web tin tưởng
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
        });

    console.log(req.query.url);
    await page.goto(req.query.url, { waitUntil: 'networkidle2', timeout: 0 });
    
// 3. Lấy nội dung (Lấy tất cả thẻ <p> và ghép lại)
    const result = await page.evaluate(() => {
        // 1. Ưu tiên tìm thẻ có id="chapter_content" (như trong ảnh bạn gửi)
            const chapterDiv = document.getElementById('chapter_content');
            let content = "";
            if (chapterDiv) {
                // Lấy toàn bộ nội dung text bên trong
                content = chapterDiv.innerText;
                
                // Xử lý một chút: Đổi xuống dòng (\n) thành dấu chấm để chị Google nghỉ lấy hơi
                // Tránh việc máy đọc liền tù tì không ngắt
                content = content.replace(/\n/g, '. ').replace(/\s+/g, ' ');
            }

            const nextElement = document.querySelector('a.next-chapter');
            
            // Lấy thuộc tính href (link) nếu tìm thấy
            const nextLink = nextElement ? nextElement.href : null;

            const fullHTML = document.documentElement.outerHTML;

            return { content, nextLink , fullHTML};
    });

    console.log(result.fullHTML);
    // 2. Lấy LINK NEXT CHAPTER (Theo yêu cầu của bạn)
            // Tìm thẻ <a> có class là "next-chapter"
    
    console.log(JSON.stringify(result));
    if (result.nextLink) {
            // encodeURI để tránh lỗi nếu link có ký tự lạ
            res.set('X-Next-Url', encodeURI(result.nextLink));
    }



    // Đóng trình duyệt
    await browser.close();

    handleTTS(result.content, res);
     } catch (err) {
        console.error(err);
        res.status(500).send('Lỗi server');
    }
});

async function handleTTS(text, res) {
    if (!text) return res.status(400).send('Không có nội dung');
    
    try {
        const results = await googleTTS.getAllAudioBase64(text, {
            lang: 'vi',
            slow: false,
            host: 'https://translate.google.com',
            splitPunct: ',.?!', // Ngắt câu thông minh
        });
        const combinedBase64 = results.map(item => item.base64).join('');
        const audioBuffer = Buffer.from(combinedBase64, 'base64');

        res.set({ 'Content-Type': 'audio/mp3', 'Content-Length': audioBuffer.length , 'Access-Control-Expose-Headers': 'X-Next-Url'});
        res.send(audioBuffer);
    } catch (err) {
        console.error("Lỗi TTS:", err);
        res.status(500).send('Lỗi khi chuyển giọng nói');
    }
}


app.listen(PORT, () => {
    console.log('Server running at http://localhost:' + PORT);
});
