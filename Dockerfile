FROM ubuntu:18.04

# Update Ubunut Software Repo
RUN apt-get update

# Create autodock vina directory
WORKDIR /opt/autodock

# Copy autodock binary into work directory
COPY vina .

# Expose port 80 for API
EXPOSE 80
