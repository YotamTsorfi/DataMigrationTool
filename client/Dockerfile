FROM node:20 as build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# הוסף ARG לכל משתנה שחשוב לך
ARG REACT_APP_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL

ARG REACT_APP_OTHER_VAR
ENV REACT_APP_OTHER_VAR=$REACT_APP_OTHER_VAR

RUN npm run build

# שלב הפצה עם nginx
FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY public/robots.txt /usr/share/nginx/html/robots.txt
COPY public/favicon.ico /usr/share/nginx/html/favicon.ico

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]