# Sử dụng image Node.js chính thức phiên bản 20 làm nền
FROM node:20-slim

# Thiết lập thư mục làm việc bên trong container
WORKDIR /app

# Sao chép file package.json và package-lock.json vào thư mục làm việc
COPY package*.json ./

# Chạy lệnh "npm install" và "npx playwright install" (thông qua postinstall)
# Lệnh này sẽ cài đặt tất cả dependencies và trình duyệt Chromium
RUN npm install

# Sao chép toàn bộ mã nguồn còn lại của ứng dụng vào thư mục làm việc
COPY . .

# Mở cổng 3000 để bên ngoài có thể truy cập vào ứng dụng
EXPOSE 3000

# Lệnh để khởi chạy ứng dụng khi container bắt đầu
CMD [ "node", "server.js" ]