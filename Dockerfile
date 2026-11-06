FROM node:20-alpine

# Cài đặt tzdata và thiết lập múi giờ Việt Nam (Asia/Ho_Chi_Minh)
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Ho_Chi_Minh /etc/localtime && \
    echo "Asia/Ho_Chi_Minh" > /etc/timezone

# Đặt biến môi trường hệ thống
ENV TZ=Asia/Ho_Chi_Minh
ENV NODE_ENV=production

# Thiết lập thư mục làm việc
WORKDIR /app

# Tận dụng Docker layer cache: chỉ copy package files trước
COPY package*.json ./

# Cài đặt production dependencies
RUN npm ci --omit=dev

# Copy toàn bộ mã nguồn vào container
COPY . .

# Khởi chạy bot daemon
CMD ["node", "index.js"]
