FROM node:20 as build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

RUN npm run build

# שלב הפצה עם nginx
FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY public/robots.txt /usr/share/nginx/html/robots.txt
COPY public/favicon.ico /usr/share/nginx/html/favicon.ico

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]