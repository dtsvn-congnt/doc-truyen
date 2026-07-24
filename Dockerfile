# Sử dụng image Node.js chính thức phiên bản 20 làm nền
FROM node:20

# Thiết lập thư mục làm việc bên trong container
WORKDIR /app

# Sao chép các file quản lý dependency của Yarn
COPY package.json yarn.lock ./

# Chạy lệnh "yarn install" để cài đặt dependencies một cách đáng tin cậy
RUN yarn install --frozen-lockfile

# Sao chép toàn bộ mã nguồn còn lại của ứng dụng vào thư mục làm việc
COPY . .

# Mở cổng 3000 để bên ngoài có thể truy cập vào ứng dụng
EXPOSE 3000

# Lệnh để khởi chạy ứng dụng khi container bắt đầu
CMD [ "node", "server.js" ]