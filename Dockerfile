# Sử dụng image chính thức của Playwright, đã cài sẵn trình duyệt và dependencies
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

# Thiết lập thư mục làm việc bên trong container
WORKDIR /app

# Sao chép các file quản lý dependency
COPY package.json package-lock.json ./

# Cài đặt các gói Node.js của ứng dụng
# Không cần chạy "npx playwright install" nữa vì trình duyệt đã có sẵn
RUN npm install

# Sao chép mã nguồn ứng dụng
COPY . .

# Mở cổng 3000 để bên ngoài có thể truy cập vào ứng dụng
EXPOSE 3000

# Lệnh để khởi chạy ứng dụng khi container bắt đầu
CMD ["node", "server.js"]