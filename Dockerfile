FROM ubuntu:18.04

# Update Ubuntu Software Repo and install curl
RUN apt-get update && apt-get install curl --yes

# Install node + npm
RUN curl -sL https://deb.nodesource.com/setup_12.x | bash - && \
    apt-get install nodejs --yes

# Create autodock vina directory
WORKDIR /opt/autodock

# Copy package.json into work directory
COPY package.json .

# Install node modules
RUN npm install

# Copy the rest of the files and autodock binary
COPY . .

# Add execute permissions to autodock binary
RUN /bin/bash -c 'chmod +x vina' 

# Expose port 8000 for API
EXPOSE 8000

CMD ["npm", "start"]