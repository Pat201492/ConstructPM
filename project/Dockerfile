FROM node:20-alpine

WORKDIR /app

# Install system tesseract as fallback OCR (tesseract.js is primary via WASM)
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-eng

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm install --omit=dev

# Copy application code
COPY . .

# Create all storage directories
RUN mkdir -p storage/bids storage/projects storage/inbox/timesheets storage/inbox/invoices storage/inbox/purchase_orders storage/templates/bid storage/equipment_docs storage/temp

EXPOSE 3000

CMD ["node", "src/server.js"]
