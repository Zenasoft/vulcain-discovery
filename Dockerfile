FROM mhart/alpine-node:5.8

WORKDIR /app
COPY package.json /app/package.json
RUN npm install --production && \
    rm -rf node_modules/clarinet/bench && \
    rm -rf node_modules/clarinet/samples && \
    rm -rf node_modules/clarinet/test \
    rm -rf node_modules/JSONStream/test && rm node_modules/JSONStream/examples \
    rm -rf node_modules/rx/ts && rm node_modules/rx/dist/*.min.js && rm node_modules/rx/dist/*.map \
    rm -rf node_modules/reflect-metadata/spec && rm -rf node_modules/reflect-metadata/test && rm -rf node_modules/reflect-metadata/temp
    
COPY lib /app

ENTRYPOINT ["node", "index.js"]
