FROM busybox:1.36
COPY src /www/src
RUN echo ok > /www/health
CMD ["httpd", "-f", "-p", "3000", "-h", "/www"]
