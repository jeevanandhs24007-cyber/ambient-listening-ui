# -----------------------------
# Step 1: Build the React app
# -----------------------------
FROM node:18-alpine AS build

# Set working directory
WORKDIR /app

# Copy and install dependencies
COPY package*.json ./
RUN npm install 

# Copy source code
COPY . .


# Build the production app
RUN npm run build

# -----------------------------
# Step 2: Serve the app with 'serve'
# -----------------------------
FROM node:18-alpine


# Install 'serve' globally
RUN npm install -g serve

# Set working directory
WORKDIR /app



# Copy build output from previous stage
COPY --from=build /app/build ./build

# Cloud Run expects the app to listen on port 8080
ENV PORT=8080

# Expose the port
EXPOSE 8080


# Run the app
CMD ["serve", "-s", "build", "-l", "8080"]