FROM oven/bun:alpine

RUN apk add --no-cache git ca-certificates openssh-client github-cli

RUN adduser -D -h /home/raccoon raccoon \
 && mkdir -p /home/raccoon/.ssh \
 && chown -R raccoon:raccoon /home/raccoon/.ssh \
 && chmod 700 /home/raccoon/.ssh

USER raccoon
WORKDIR /home/raccoon/workspace
