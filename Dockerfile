FROM node:20

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# העתק קבצי env (אם צריך)
COPY .env.production .env

RUN npm run build

EXPOSE 3002

CMD ["npm", "run", "start:prod"]