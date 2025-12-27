//process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'; // Chấp nhận lỗi SSL nếu có (lưu ý bảo mật)

const express = require('express');
//const googleTTS = require('google-tts-api');
const path = require('path');
const cheerio = require('cheerio'); // Thay thế cho việc quét DOM

const app = express();
const PORT = 3000;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/speak', async (req, res) => {
    const url = req.query.url;
    // 1. Lấy cookie từ client gửi lên
    const userCookie = req.query.cookie || ''; 

    if (!url) return res.status(400).send('Thiếu URL');

    console.log("Processing URL:", url);

    try {
       // --- PHẦN QUAN TRỌNG NHẤT: gotScraping ---
        // Thư viện này tự động giả lập vân tay TLS của Chrome xịn
		const { gotScraping } = await import('got-scraping');
        const response = await gotScraping({
            url: url,
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 110 }],
                devices: ['desktop'],
                locales: ['vi-VN'],
                operatingSystems: ['windows'],
            },
            headers: {
                // Nếu người dùng nhập cookie thì gắn vào
                ...(userCookie ? { 'cookie': userCookie } : {})
            },
            // Tự động xử lý redirect, tự giải nén gzip
        });
        // -------------------------------------------

        const $ = cheerio.load(response.body);

        // 3. Lấy nội dung truyện
        const chapterDiv = $('#chapter_content');
        let content = "";

        if (chapterDiv.length) {
            // 1. XỬ LÝ THẺ BR THÔNG MINH
            // Duyệt qua từng thẻ <br>
            chapterDiv.find('br').each((i, el) => {
                // Lấy phần tử đứng ngay trước thẻ <br>
                const prevNode = el.previousSibling;
                
                // Kiểm tra: Nếu phần tử trước là Text và kết thúc bằng dấu câu (. ? ! " ”)
                if (prevNode && prevNode.type === 'text') {
                    const text = prevNode.data.trim();
                    // Regex check đuôi: Kết thúc bằng . ! ? hoặc " ”
                    if (/[.?!"”']$/.test(text)) {
                        $(el).replaceWith(' '); // Đã có dấu câu -> Chỉ thêm khoảng trắng
                        return; // Xong, sang thẻ khác
                    }
                }
                // Nếu chưa có dấu câu -> Thêm dấu chấm và khoảng trắng
                $(el).replaceWith('. ');
            });

            // Xử lý thẻ P (thường là hết đoạn cũng cần chấm)
            chapterDiv.find('p').each((i, el) => {
                $(el).append('. ');
            });

            // 2. LẤY TEXT VÀ DỌN DẸP SƠ BỘ
            content = chapterDiv.text();
            
            // Xóa dấu chấm thừa (.. -> .)
            content = content.replace(/\.(\s*\.)+/g, '.');
            // Xóa dấu chấm vô duyên sau dấu ngoặc kép (Example: ”. -> ”)
            content = content.replace(/([”"'])\./g, '$1'); 
            // Xóa khoảng trắng thừa
            content = content.replace(/\s+/g, ' ').trim();
        } else {
             return res.status(403).json({ error: "Không lấy được nội dung (Có thể bị chặn hoặc sai Selector)" });
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
       // await handleTTS(content, res);
	   res.json({
            content: content,
            nextLink: nextLink
        });

    } catch (err) {
        console.error("Lỗi cào dữ liệu:", err.message);
        // Kiểm tra nếu lỗi do Axios (VD: 404, 403)
        if (err.response) {
            return res.status(err.response.status).send(`Lỗi từ web nguồn: ${err.response.statusText}`);
        }
        res.status(500).send('Lỗi server nội bộ');
    }
});

// async function handleTTS(text, res) {
    // if (!text || text.trim().length === 0) return res.status(400).send('Không tìm thấy nội dung truyện');

    // try {
      /*   Cắt bớt nếu text quá dài để tránh lỗi Google TTS (Giới hạn khoảng 200 ký tự mỗi request của lib này)
        Nhưng google-tts-api tự xử lý split, chỉ cần đảm bảo server không timeout
         */
        // const results = await googleTTS.getAllAudioBase64(text, {
			// lang: 'vi',
			// slow: false,
			/* 1. Dùng domain global hoặc domain API này thường ít bị chặn hơn */
			// host: 'https://translate.google.com',
			/* 2. Tăng timeout lên 20 giây (Render free tier mạng khởi động hơi chậm) */
			// timeout: 30000,
			// splitPunct: ',.?!',
		// });
        
        // const combinedBase64 = results.map(item => item.base64).join('');
        // const audioBuffer = Buffer.from(combinedBase64, 'base64');

        // res.set({ 
            // 'Content-Type': 'audio/mp3', 
            // 'Content-Length': audioBuffer.length,
            // 'Access-Control-Expose-Headers': 'X-Next-Url' 
        // });
        // res.send(audioBuffer);
    // } catch (err) {
        // console.error("Lỗi TTS:", err);
        // res.status(500).send('Lỗi khi chuyển giọng nói');
    // }
// }

app.listen(PORT, () => {
    console.log('Server running at http://localhost:' + PORT);
});