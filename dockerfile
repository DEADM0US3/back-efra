# Usa una imagen ligera de Node
FROM node:22-alpine

# Directorio de la app
WORKDIR /app

# Copia defs de dependencias e instala
COPY package*.json ./
RUN npm install

# Copia el resto del código
COPY . .

# Expone el puerto de la API
EXPOSE 3000

# Arranca en modo desarrollo con nodemon
CMD ["npm", "run", "dev"]
