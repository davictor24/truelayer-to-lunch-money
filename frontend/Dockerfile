# Use Node base image
FROM node:21-alpine as build

# Set environment variables from arguments
ARG REACT_APP_TRUELAYER_SERVICE_ORIGIN
ENV REACT_APP_TRUELAYER_SERVICE_ORIGIN $REACT_APP_TRUELAYER_SERVICE_ORIGIN

# Build app
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build

# Copy to Nginx for static hosting
FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html

# Set the app's port number
EXPOSE 80
