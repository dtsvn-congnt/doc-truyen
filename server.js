const cheerio = require('cheerio');
const pako = require('pako');
const path = require('path');
const fs = require('fs/promises');

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

    // Giải nén bằng Pako để có Uint8Array
    const decompressedData = pako.inflate(binaryData);

    // Chuyển Uint8Array thành chuỗi text UTF-8
    const decodedHtml = new TextDecoder().decode(decompressedData);
    return decodedHtml;
}

/**
 * Tải và lưu một chương truyện.
 * @param {string} url URL của chương
 * @param {number} chapterNumber Số thứ tự chương
 * @param {string} outputDir Thư mục lưu file
 * @returns {Promise<string|null>} URL của chương tiếp theo, hoặc null nếu kết thúc.
 */
async function downloadChapter(url, chapterNumber, outputDir) {
    if (!url) {
        console.log('Không có URL chương, dừng lại.');
        return null;
    }

    console.log(`Đang tải chương ${chapterNumber} từ: ${url}`);

    try {
        // Sử dụng got-scraping để tải trang, giúp vượt qua các biện pháp chống cào dữ liệu
        const { gotScraping } = await import('got-scraping');

        const response = await gotScraping({
            url: url,
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 110 }],
                devices: ['desktop'],
                locales: ['vi-VN'],
                operatingSystems: ['windows'],
            },
        });

        const $ = cheerio.load(response.body);

        // Tìm link chương tiếp theo
        const nextElement = $('div.nav-next a');
        let nextLink = nextElement.attr('href');
        if (nextLink && !nextLink.startsWith('http')) {
            // Đảm bảo URL tiếp theo là URL tuyệt đối
            const baseUrl = new URL(url);
            nextLink = new URL(nextLink, baseUrl.origin).href;
        }

        // Trích xuất nội dung được mã hóa từ biến data_x
        // Thử lấy nội dung từ data_x trước
        const scriptContent = $('script:contains("const data_x")').html();
        const match = scriptContent ? scriptContent.match(/const data_x\s*=\s*['"]([^'"]+)['"]\s*;/) : null;

        if (match && match[1]) {
            const encodedContent = match[1];
            const decodedHtml = decodeContent(encodedContent);

            // Tạo tên file và đường dẫn đầy đủ
            const fileName = `chapter-${String(chapterNumber).padStart(4, '0')}.html`;
            const filePath = path.join(outputDir, fileName);

            // Lưu nội dung đã giải mã vào file
            await fs.writeFile(filePath, decodedHtml);
            console.log(`Đã lưu thành công: ${filePath}`);
        } else {
            console.log(`Không tìm thấy nội dung (data_x) cho chương ${chapterNumber}. Bỏ qua.`);
        }

        return nextLink;

    } catch (error) {
        console.error(`Lỗi khi tải chương ${chapterNumber} (${url}):`, error.message);
        // Dừng lại khi có lỗi
        return null;
    }
}

/**
 * Hàm chính để bắt đầu quá trình tải truyện.
 */
async function main() {
    // --- CẤU HÌNH ---
    // URL của chương đầu tiên bạn muốn tải
    const startUrl = 'https://www.xtruyen.vn/truyen/tu-tien-ta-that-khong-co-muon-lam-liem-cho/chuong-';

    // Tên thư mục để lưu các file truyện
    const storyFolderName = 'data';
    // --- KẾT THÚC CẤU HÌNH ---

    const outputDir = path.join(__dirname, storyFolderName);

    // Tạo thư mục lưu truyện nếu nó chưa tồn tại
    try {
        await fs.mkdir(outputDir, { recursive: true });
        console.log(`Các chương sẽ được lưu tại: ${outputDir}`);
    } catch (error) {
        console.error('Không thể tạo thư mục lưu trữ:', error);
        return;
    }
    let chapterNumber = 758; // Bạn có thể thay đổi số chương bắt đầu nếu muốn tải tiếp

    let currentUrl = startUrl + chapterNumber;
    

    
    while (currentUrl) {
        const nextUrl = await downloadChapter(currentUrl, chapterNumber, outputDir);

        if (nextUrl) {
            currentUrl = nextUrl;
            chapterNumber++;
            // Thêm một khoảng nghỉ nhỏ (ví dụ: 2 giây) để tránh làm quá tải server của trang web
            console.log('Nghỉ 2 giây trước khi tải chương tiếp theo...');
            await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
            currentUrl = null; // Dừng vòng lặp
        }
    }

    console.log('===================================');
    console.log('✅ Hoàn tất tải toàn bộ các chương!');
    console.log('===================================');
}

// Chạy hàm chính
main().catch(error => {
    console.error("Đã xảy ra lỗi không mong muốn trong quá trình chạy:", error);
});