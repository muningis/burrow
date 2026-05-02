FROM oven/bun:alpine

RUN apk add --no-cache git ca-certificates

RUN adduser -D -h /home/raccoon raccoon

USER raccoon
WORKDIR /home/raccoon/workspace
