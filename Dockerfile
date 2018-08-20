FROM node:alpine
MAINTAINER Jiewei Qian <qjw@wacky.one>

ADD . .
RUN yarn install && mkdir -p /root/data/

# TODO: make Dockerfile include crontab support
ENTRYPOINT ["bin/ghdc-vuln", "-O", "/root/data"]
