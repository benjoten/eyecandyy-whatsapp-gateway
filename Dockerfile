FROM node:20-alpine

# Install git, python3, make, g++ needed for node module compilation
RUN apk add --no-cache git python3 make g++

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
