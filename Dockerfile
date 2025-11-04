# Stage 1: Build the application
FROM node:18-alpine AS builder

WORKDIR /usr/src/app

# Copy workspace configuration and all package.json files first
COPY package*.json ./
COPY shared/package*.json ./shared/
COPY packages/mcp-server/package*.json ./packages/mcp-server/
COPY packages/foundry-module/package*.json ./packages/foundry-module/

# Install dependencies (this will set up the workspace correctly)
RUN npm install

# Copy source files and tsconfig files
COPY tsconfig.json ./
COPY shared/ ./shared/
COPY packages/ ./packages/

# Build the project
RUN npm run build

# Stage 2: Create the production image
FROM node:18-alpine

WORKDIR /usr/src/app

# Copy workspace configuration
COPY package*.json ./
COPY shared/package*.json ./shared/
COPY packages/mcp-server/package*.json ./packages/mcp-server/
COPY packages/foundry-module/package*.json ./packages/foundry-module/

# Install production dependencies
RUN npm install --production

# Copy built files from builder stage
COPY --from=builder /usr/src/app/shared/dist ./shared/dist
COPY --from=builder /usr/src/app/packages/mcp-server/dist ./packages/mcp-server/dist
COPY --from=builder /usr/src/app/packages/foundry-module/dist ./packages/foundry-module/dist

EXPOSE 3000
EXPOSE 31414
EXPOSE 31415
EXPOSE 31416

# Start the MCP backend server
CMD ["node", "packages/mcp-server/dist/backend.js"]
