FROM node:20-alpine

# Install git, python3, make, g++, and system fonts for crisp SVG text rendering
RUN apk add --no-cache git python3 make g++ font-dejavu font-freefont ttf-dejavu ttf-liberation

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
