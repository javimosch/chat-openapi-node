FROM node:20.17.0-alpine

WORKDIR /usr/src/app

# Copy package.json and package-lock.json first to leverage Docker layer caching
COPY package*.json ./

# Install dependencies in production mode
RUN npm install --production

# Copy the rest of the application code
COPY src ./src
COPY public ./public

# Set the entrypoint
CMD ["npm", "run", "start"]
