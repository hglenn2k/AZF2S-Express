FROM node:latest

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Expose the port
EXPOSE 3001

# Set environment variable
ENV NODE_ENV=production

# Command to run the server
CMD ["node", "server.js"]